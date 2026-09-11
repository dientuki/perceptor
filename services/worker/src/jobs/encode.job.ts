import type { Job } from 'bullmq';
import { fetchGraphQL } from '../api/graphql-client';
import { deliverReport } from '../api/deliver-report';
import { buildOutputPath } from '../paths/build-output-path';
import { encode } from '../encode';
import { passthrough } from '../encode/passthrough';
import { withSourceExtension } from '../paths/with-source-extension';
import { isInsideRoot } from '../paths/is-inside-root';
import { cleanupSource } from './cleanup-source';
import { buildContainerTitle, buildSourceTag } from '../metadata/container-tags';
import { fetchTrackTitles } from '../api/track-titles';
import type { EncodeJob } from '../queue/types';
import { KeyedError } from '../i18n/keyed-error';
import { renderMessage } from '../i18n/messages.en';
import { ERROR_ENCODE_UNEXPECTED, ERROR_ENCODE_MOVE_FAILED } from '../i18n/error-keys';
import { EncodeCancelledError, registerEncode, releaseEncode } from '../encode/cancellation';

export type EncodeJobDetails = {
  id: number;
  status: string;
  inputFilePath: string;
  kind: string; // 'MOVIE' | 'EPISODE'
  tmdbId: number;
  title: string;
  year: number | null;
  originalLanguage: string;
  originalLanguageIso3: string;
  allowedAudioLanguagesIso3: string[];
  allowedAudioLanguageTags: string[];
  allowedSubtitleLanguagesIso3: string[];
  allowedSubtitleLanguageTags: string[];
  isLiveAction: boolean;
  seasonNumber: number | null;
  episodeNumber: number | null;
  episodeTitle: string | null;
  mediaSourceId: number;
  sourceKind: string;
  infoHash: string | null;
  downloadPath: string | null;
  outputRoot: string;
  downloadsRoot: string;
  // 032-optional-compression (REQ-6, NFR-2): resolved by the api at query
  // time, not frozen onto the ProcessJob row at enqueue time. `=== false` is
  // the only valid test — an `undefined` from a dropped field or an older
  // api must compress, never silently stop.
  compressionEnabled: boolean;
};

type ProcessJobQueryResult = {
  processJob: EncodeJobDetails | null;
};

// Retyped from EncodeCompletedResult (docs/spec/graphql-contract.md,
// 013-season-pack-processing). The three booleans are instructions computed
// server-side from sibling ProcessJob rows and hasUnmatchedFiles — the
// worker cannot see either, so it never approximates them, only executes
// whichever arrive true (NFR-2/NFR-3, see below).
type EncodeCompletedResult = {
  message: string;
  removeTorrent: boolean;
  deleteInputFile: boolean;
  deleteDownloadPath: boolean;
};

type EncodeCompletedMutationResult = {
  encodeCompleted: EncodeCompletedResult;
};

// Mínimo salto de progreso entre mutations a la api. Con el mock (10 pasos)
// esto ya viene grueso; con FFmpeg real (stderr cada pocos ms) es lo que evita
// convertir un encode de 2 horas en una mutation por línea de log.
const PROGRESS_STEP = 5;

export async function handleEncode(job: Job<EncodeJob>): Promise<void> {
  const { processJobId } = job.data;

  const { processJob: details } = await fetchGraphQL<ProcessJobQueryResult>(
    `query ($id: Int!) {
      processJob(id: $id) {
        id status inputFilePath kind tmdbId title year originalLanguage originalLanguageIso3 allowedAudioLanguagesIso3 allowedAudioLanguageTags allowedSubtitleLanguagesIso3 allowedSubtitleLanguageTags isLiveAction
        seasonNumber episodeNumber episodeTitle
        mediaSourceId sourceKind infoHash downloadPath outputRoot downloadsRoot
        compressionEnabled
      }
    }`,
    { id: processJobId },
  );

  if (!details) {
    throw new Error(`processJob ${processJobId} no existe`);
  }

  // NFR-2: `=== false` is the only valid test, so this log names the exact
  // branch taken rather than paraphrasing it — an `undefined` here reads as
  // "compressing", which is the safe default and must be visible as such.
  const compressing = details.compressionEnabled !== false;
  console.log(
    `[encode] ${processJobId}: compressing=${compressing} allowedAudioLanguagesIso3=${JSON.stringify(details.allowedAudioLanguagesIso3)} allowedAudioLanguageTags=${JSON.stringify(details.allowedAudioLanguageTags)} allowedSubtitleLanguagesIso3=${JSON.stringify(details.allowedSubtitleLanguagesIso3)} allowedSubtitleLanguageTags=${JSON.stringify(details.allowedSubtitleLanguageTags)} originalLanguageIso3=${details.originalLanguageIso3}`,
  );

  const trackTitles = await fetchTrackTitles();

  const signal = registerEncode(processJobId);

  try {
    let encodeCompleted: EncodeCompletedResult | undefined;
    let finalOutputPathForReport: string;
    let ffmpegCommandForReport: string;

    try {
      const outputPath = buildOutputPath(details);

      await fetchGraphQL(
        `mutation ($id: Int!) { encodeStarted(processJobId: $id) }`,
        { id: processJobId },
      );

      let lastReported = -1;
      // Awaited, no fire-and-forget: dos updates concurrentes sobre el mismo
      // ProcessJob (un progreso todavía en vuelo + el encodeCompleted de más
      // abajo) chocan contra el PrismaService singleton (una sola conexión vía
      // PrismaMariaDb) con "Record has changed since last read" (MariaDB 1020).
      // Esperar cada mutation antes de seguir el loop del encode lo evita del
      // todo. Un progreso perdido sí se traga (no debe frenar el encode).
      const onProgress = async (progress: number) => {
        if (progress !== 100 && progress - lastReported < PROGRESS_STEP) return;
        lastReported = progress;

        try {
          await fetchGraphQL(
            `mutation ($id: Int!, $p: Int!) { encodeProgress(processJobId: $id, progress: $p) }`,
            { id: processJobId, p: progress },
          );
        } catch (err) {
          console.error(`[encode] no se pudo reportar progreso de ${processJobId}:`, err);
        }
      };

      // Recorded once per encode, before FFmpeg starts (REQ-1, 023-ffprobe-log).
      // The try/catch below covers only the fetchGraphQL call — widening it
      // would swallow a real ffprobe failure and let the encode continue with
      // no metadata (worker/plan.md § Steps 5).
      const onProbe = async (file: string, ffprobe: string) => {
        try {
          await fetchGraphQL(
            `mutation ($file: String!, $ffprobe: String!) {
              recordFfprobe(file: $file, ffprobe: $ffprobe) { id }
            }`,
            { file, ffprobe },
          );
        } catch (err) {
          console.error(`[encode] ${processJobId}: failed to record ffprobe, continuing encode:`, err);
        }
      };

      // 032-optional-compression (REQ-9..REQ-13): `=== false` only, per NFR-2 —
      // an `undefined` compressionEnabled (dropped field, or an api that
      // predates this feature) must compress, never silently skip FFmpeg.
      let finalOutputPath = outputPath;
      let ffmpegCommand: string;

      if (details.compressionEnabled === false) {
        // REQ-12: the relaxed path is not the one that skips the containment
        // check the encode path applies today (indirectly, via cleanup-source's
        // own guard) — check it up front here, before anything touches the file.
        if (!isInsideRoot(details.downloadsRoot, details.inputFilePath)) {
          const detail = `input file ${details.inputFilePath} is not inside downloadsRoot ${details.downloadsRoot}`;
          throw new KeyedError(ERROR_ENCODE_MOVE_FAILED, renderMessage(ERROR_ENCODE_MOVE_FAILED, { detail }), {
            detail,
          });
        }

        finalOutputPath = withSourceExtension(outputPath, details.inputFilePath);

        const passthroughResult = await passthrough(
          details.inputFilePath,
          finalOutputPath,
          {
            originalLanguageIso3: details.originalLanguageIso3,
            allowedAudioLanguagesIso3: details.allowedAudioLanguagesIso3,
            allowedAudioLanguageTags: details.allowedAudioLanguageTags ?? [],
            allowedSubtitleLanguagesIso3: details.allowedSubtitleLanguagesIso3,
            allowedSubtitleLanguageTags: details.allowedSubtitleLanguageTags ?? [],
            isLiveAction: details.isLiveAction,
            containerTitle: buildContainerTitle(details),
            sourceTag: buildSourceTag(details.downloadsRoot, details.inputFilePath, details.downloadPath),
            trackTitles: trackTitles,
          },
          onProgress,
          onProbe,
          signal,
        );
        ffmpegCommand = passthroughResult.ffmpegCommand;
      } else {
        const encodeResult = await encode(
          details.inputFilePath,
          outputPath,
          {
            originalLanguageIso3: details.originalLanguageIso3,
            allowedAudioLanguagesIso3: details.allowedAudioLanguagesIso3,
            allowedAudioLanguageTags: details.allowedAudioLanguageTags ?? [],
            allowedSubtitleLanguagesIso3: details.allowedSubtitleLanguagesIso3,
            allowedSubtitleLanguageTags: details.allowedSubtitleLanguageTags ?? [],
            isLiveAction: details.isLiveAction,
            containerTitle: buildContainerTitle(details),
            sourceTag: buildSourceTag(details.downloadsRoot, details.inputFilePath, details.downloadPath),
            trackTitles: trackTitles,
          },
          onProgress,
          onProbe,
          signal,
        );
        ffmpegCommand = encodeResult.ffmpegCommand;
      }

      // 038-encode-report-durability (REQ-1): the try ends here, once the
      // encode/passthrough has actually produced the output file. Reporting
      // that outcome to api is a separate concern from producing it — a
      // transport failure below must never be read by the catch as "the
      // encode itself failed".
      finalOutputPathForReport = finalOutputPath;
      ffmpegCommandForReport = ffmpegCommand;
    } catch (error) {
      // REQ-6 (047-source-deletion): a job abandoned because its source was
      // deleted reports nothing — no encodeCompleted, no encodeFailed, no
      // deliverReport, no cleanupSource. Checked before the KeyedError branch
      // below, since EncodeCancelledError is deliberately not one.
      if (error instanceof EncodeCancelledError) {
        console.log(`[encode] ${processJobId}: cancelled, reporting nothing`);
        throw error;
      }

      // encodeFailed's errorKey is required (REQ-11, docs/spec/graphql-contract.md):
      // there is no path where this reports a failure with no key. A KeyedError
      // (every throw site in ffmpeg/, paths/, encode/ and graphql-client.ts) carries
      // its own key/params; anything else — a bug, an uncaught library error — still
      // needs one, so it falls back to the catch-all ERROR_ENCODE_UNEXPECTED with the
      // raw message carried as a param rather than silently reporting no key at all.
      const keyed = error instanceof KeyedError;
      const errorKey = keyed ? error.key : ERROR_ENCODE_UNEXPECTED;
      const errorParams = keyed
        ? error.params
        : { detail: error instanceof Error ? error.message : String(error) };
      const errorMessage = renderMessage(errorKey, errorParams);

      // 038-encode-report-durability (REQ-1, REQ-2): held until api
      // acknowledges it, retried only while unreachable (deliverReport). No
      // longer .catch(console.error)'d — swallowing this call is exactly the
      // bug that lost the incident's report; the throw below still carries
      // the original encode error regardless of how the report went.
      await deliverReport(`encodeFailed(${processJobId})`, () =>
        fetchGraphQL(
          `mutation ($id: Int!, $key: String!, $params: String, $msg: String!) {
            encodeFailed(processJobId: $id, errorKey: $key, errorParams: $params, errorMessage: $msg)
          }`,
          {
            id: processJobId,
            key: errorKey,
            params: errorParams ? JSON.stringify(errorParams) : undefined,
            msg: errorMessage,
          },
        ),
      );

      throw error;
    }

    // 038-encode-report-durability (REQ-1, REQ-2): outside the try/catch above
    // on purpose — the encode has already produced its output file at this
    // point, so a transport failure delivering the report must never be read
    // as an encode failure. deliverReport holds this call until api
    // acknowledges it; the encode queue's concurrency: 1 (src/index.ts) is
    // what makes that blocking acceptable (REQ-4).
    const result = await deliverReport(`encodeCompleted(${processJobId})`, () =>
      fetchGraphQL<EncodeCompletedMutationResult>(
        `mutation ($id: Int!, $out: String!, $cmd: String!) {
          encodeCompleted(processJobId: $id, outputFilePath: $out, ffmpegCommand: $cmd) {
            message
            removeTorrent
            deleteInputFile
            deleteDownloadPath
          }
        }`,
        { id: processJobId, out: finalOutputPathForReport, cmd: ffmpegCommandForReport },
      ),
    );
    encodeCompleted = result.encodeCompleted;

    console.log(`[encode] ${processJobId}: ${encodeCompleted.message} -> ${finalOutputPathForReport}`);

    // El aviso al media server (Jellyfin, si está configurado) lo dispara el
    // api dentro de encodeCompleted — tiene las settings y las raíces, el
    // worker no necesita enterarse.

    // Cleanup runs after the encode's try/catch has already closed: the job is
    // already reported completed at this point, and nothing here may flip it
    // back to failed. cleanupSource itself never throws (see its header
    // comment), but this second try is a deliberate line of defence in case it
    // ever does despite that contract.
    //
    // The three instructions below are computed server-side (sibling
    // ProcessJob rows, hasUnmatchedFiles) and the worker cannot see either
    // (013-season-pack-processing). If any arrives undefined — the field was
    // dropped from the mutation selection, or api predates this feature —
    // cleanup is skipped entirely and the missing field is named loudly: never
    // read a missing instruction as false (leaks torrents/files forever) and
    // never as true (deletes something nobody decided to delete).
    try {
      if (!encodeCompleted) {
        console.error(`[encode] ${processJobId}: encodeCompleted no devolvió resultado — cleanup omitido`);
      } else {
        const { removeTorrent, deleteInputFile, deleteDownloadPath } = encodeCompleted;
        const missing: string[] = [];
        if (removeTorrent === undefined) missing.push('removeTorrent');
        if (deleteInputFile === undefined) missing.push('deleteInputFile');
        if (deleteDownloadPath === undefined) missing.push('deleteDownloadPath');

        if (missing.length > 0) {
          console.error(
            `[encode] ${processJobId}: encodeCompleted no trajo ${missing.join(', ')} — cleanup omitido`,
          );
        } else {
          await cleanupSource({
            mediaSourceId: details.mediaSourceId,
            sourceKind: details.sourceKind,
            infoHash: details.infoHash,
            downloadPath: details.downloadPath,
            downloadsRoot: details.downloadsRoot,
            inputFilePath: details.inputFilePath,
            removeTorrent,
            deleteInputFile,
            deleteDownloadPath,
          });
        }
      }
    } catch (err) {
      console.error(`[encode] ${processJobId}: cleanupSource falló inesperadamente:`, err);
    }
  } finally {
    releaseEncode(processJobId);
  }
}
