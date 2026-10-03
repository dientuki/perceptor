import { UnrecoverableError, type Job } from 'bullmq';
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
import { normalizeContentKind } from '../encode/content-kind';
import { normalizeLibraryLayout } from '../paths/library-layout';
import { normalizeCompressionResolution } from '../encode/compression-resolution';
import { normalizeSubtitleFormats } from '../encode/subtitle-formats';

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
  allowedSubtitleFormats: string[];
  contentKind: string;
  compressionResolution: string;
  libraryLayout: string;
  seasonNumber: number | null;
  episodeNumber: number | null;
  episodeTitle: string | null;
  mediaSourceId: number;
  sourceKind: string;
  infoHash: string | null;
  downloadPath: string | null;
  outputRoot: string;
  downloadsRoot: string;
  // Spec 032, REQ-6 NFR-2
  compressionEnabled: boolean;
};

type ProcessJobQueryResult = {
  processJob: EncodeJobDetails | null;
};

// Spec 013, NFR-2 NFR-3
type EncodeCompletedResult = {
  message: string;
  removeTorrent: boolean;
  deleteInputFile: boolean;
  deleteDownloadPath: boolean;
};

type EncodeCompletedMutationResult = {
  encodeCompleted: EncodeCompletedResult;
};

const PROGRESS_STEP = 5;

export async function handleEncode(job: Job<EncodeJob>): Promise<void> {
  const { processJobId } = job.data;

  const { processJob: details } = await fetchGraphQL<ProcessJobQueryResult>(
    `query ($id: Int!) {
      processJob(id: $id) {
        id status inputFilePath kind tmdbId title year originalLanguage originalLanguageIso3 allowedAudioLanguagesIso3 allowedAudioLanguageTags allowedSubtitleLanguagesIso3 allowedSubtitleLanguageTags allowedSubtitleFormats contentKind compressionResolution libraryLayout
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

  // Spec 032, NFR-2
  const compressing = details.compressionEnabled !== false;
  const contentKind = normalizeContentKind(details.contentKind);
  const compressionResolution = normalizeCompressionResolution(details.compressionResolution);
  const libraryLayout = normalizeLibraryLayout(details.libraryLayout);
  const allowedSubtitleFormats = normalizeSubtitleFormats(details.allowedSubtitleFormats);
  console.log(
    `[encode] ${processJobId}: compressing=${compressing} allowedAudioLanguagesIso3=${JSON.stringify(details.allowedAudioLanguagesIso3)} allowedAudioLanguageTags=${JSON.stringify(details.allowedAudioLanguageTags)} allowedSubtitleLanguagesIso3=${JSON.stringify(details.allowedSubtitleLanguagesIso3)} allowedSubtitleLanguageTags=${JSON.stringify(details.allowedSubtitleLanguageTags)} originalLanguageIso3=${details.originalLanguageIso3} contentKind=${contentKind} compressionResolution=${compressionResolution} libraryLayout=${libraryLayout} allowedSubtitleFormats=${JSON.stringify(allowedSubtitleFormats)}`,
  );

  const trackTitles = await fetchTrackTitles();

  const signal = registerEncode(processJobId);

  try {
    let encodeCompleted: EncodeCompletedResult | undefined;
    let finalOutputPathForReport: string;
    let ffmpegCommandForReport: string;

    try {
      const outputPath = buildOutputPath({ ...details, layout: libraryLayout });

      await fetchGraphQL(
        `mutation ($id: Int!) { encodeStarted(processJobId: $id) }`,
        { id: processJobId },
      );

      let lastReported = -1;
      const onProgress = async (progress: number, speed: number | null) => {
        if (progress !== 100 && progress - lastReported < PROGRESS_STEP) return;
        lastReported = progress;

        try {
          // Spec 053, AC-8
          await fetchGraphQL(
            `mutation ($id: Int!, $p: Int!, $s: Float) { encodeProgress(processJobId: $id, progress: $p, speed: $s) }`,
            { id: processJobId, p: progress, s: speed },
          );
        } catch (err) {
          console.error(`[encode] no se pudo reportar progreso de ${processJobId}:`, err);
        }
      };

      // Spec 023, REQ-1
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

      // Spec 032, REQ-9 REQ-10 REQ-11 REQ-12 REQ-13 NFR-2
      let finalOutputPath = outputPath;
      let ffmpegCommand: string;

      if (details.compressionEnabled === false) {
        // Spec 032, REQ-12
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
            allowedSubtitleFormats,
            contentKind,
            compressionResolution,
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
            allowedSubtitleFormats,
            contentKind,
            compressionResolution,
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

      // Spec 038, REQ-1
      finalOutputPathForReport = finalOutputPath;
      ffmpegCommandForReport = ffmpegCommand;
    } catch (error) {
      // Spec 047, REQ-6
      if (error instanceof EncodeCancelledError) {
        console.log(`[encode] ${processJobId}: cancelled, reporting nothing`);
        // Spec 054, REQ-8
        throw new UnrecoverableError(error.message);
      }

      // Spec 018, REQ-11
      const keyed = error instanceof KeyedError;
      const errorKey = keyed ? error.key : ERROR_ENCODE_UNEXPECTED;
      const errorParams = keyed
        ? error.params
        : { detail: error instanceof Error ? error.message : String(error) };
      const errorMessage = renderMessage(errorKey, errorParams);

      // Spec 038, REQ-1 REQ-2
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

      // Spec 054, REQ-9
      if (keyed) {
        throw new UnrecoverableError(error.message);
      }

      throw error;
    }

    // Spec 038, REQ-1 REQ-2 REQ-4
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

    // Spec 013, NFR-2 NFR-3
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
