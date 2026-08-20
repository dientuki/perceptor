import type { Job } from 'bullmq';
import { fetchGraphQL } from '../api/graphql-client';
import { buildOutputPath } from '../paths/build-output-path';
import { encode } from '../encode';
import { cleanupSource } from './cleanup-source';
import type { EncodeJob } from '../queue/types';
import { KeyedError } from '../i18n/keyed-error';
import { renderMessage } from '../i18n/messages.en';
import { ERROR_ENCODE_UNEXPECTED } from '../i18n/error-keys';

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
  allowedLanguagesIso3: string[];
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
        id status inputFilePath kind tmdbId title year originalLanguage originalLanguageIso3 allowedLanguagesIso3 isLiveAction
        seasonNumber episodeNumber episodeTitle
        mediaSourceId sourceKind infoHash downloadPath outputRoot downloadsRoot
      }
    }`,
    { id: processJobId },
  );

  if (!details) {
    throw new Error(`processJob ${processJobId} no existe`);
  }

  console.log(
    `[encode] ${processJobId}: allowedLanguagesIso3=${JSON.stringify(details.allowedLanguagesIso3)} originalLanguageIso3=${details.originalLanguageIso3}`,
  );

  let encodeCompleted: EncodeCompletedResult | undefined;

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

    const { ffmpegCommand } = await encode(
      details.inputFilePath,
      outputPath,
      {
        originalLanguageIso3: details.originalLanguageIso3,
        allowedLanguagesIso3: details.allowedLanguagesIso3,
        isLiveAction: details.isLiveAction,
      },
      onProgress,
    );

    const result = await fetchGraphQL<EncodeCompletedMutationResult>(
      `mutation ($id: Int!, $out: String!, $cmd: String!) {
        encodeCompleted(processJobId: $id, outputFilePath: $out, ffmpegCommand: $cmd) {
          message
          removeTorrent
          deleteInputFile
          deleteDownloadPath
        }
      }`,
      { id: processJobId, out: outputPath, cmd: ffmpegCommand },
    );
    encodeCompleted = result.encodeCompleted;

    console.log(`[encode] ${processJobId}: ${encodeCompleted.message} -> ${outputPath}`);

    // El aviso al media server (Jellyfin, si está configurado) lo dispara el
    // api dentro de encodeCompleted — tiene las settings y las raíces, el
    // worker no necesita enterarse.
  } catch (error) {
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

    await fetchGraphQL(
      `mutation ($id: Int!, $key: String!, $params: String, $msg: String!) {
        encodeFailed(processJobId: $id, errorKey: $key, errorParams: $params, errorMessage: $msg)
      }`,
      {
        id: processJobId,
        key: errorKey,
        params: errorParams ? JSON.stringify(errorParams) : undefined,
        msg: errorMessage,
      },
    ).catch((err) => console.error(`[encode] no se pudo reportar el fallo de ${processJobId}:`, err));

    throw error;
  }

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
}
