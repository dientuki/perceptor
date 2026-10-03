import { UnrecoverableError, type Job } from 'bullmq';
import { deliverReport } from '../api/deliver-report';
import { fetchGraphQL } from '../api/graphql-client';
import { scanFolder } from '../scan/scan-folder';
import { markDownloaded } from '../scan/mark-downloaded';
import { selectMatches, type Match, type SelectMatchesMode } from '../scan/select-matches';
import type { SourceReadyJob } from '../queue/types';
import { KeyedError } from '../i18n/keyed-error';
import { renderMessage } from '../i18n/messages.en';
import {
  ERROR_SOURCE_NO_DOWNLOAD_PATH,
  ERROR_SOURCE_NO_TARGET,
  ERROR_SOURCE_SCAN_FAILED,
} from '../i18n/error-keys';

type MediaSourceQueryResult = {
  mediaSource: {
    id: number;
    status: string;
    downloadPath: string | null;
    releaseTitle: string | null;
    movieId: number | null;
    episodeId: number | null;
    seasonId: number | null;
    downloadedFiles: string[] | null;
  } | null;
};

type SourceScannedMutationResult = {
  sourceScanned: {
    id: number;
    status: string;
    errorMessage: string | null;
  };
};

// Spec 013, REQ-1
function selectMode(mediaSource: NonNullable<MediaSourceQueryResult['mediaSource']>): SelectMatchesMode {
  if (mediaSource.movieId !== null || mediaSource.episodeId !== null) {
    return { kind: 'single' };
  }
  if (mediaSource.seasonId !== null) {
    return { kind: 'season' };
  }
  const params = { id: mediaSource.id };
  throw new KeyedError(
    ERROR_SOURCE_NO_TARGET,
    renderMessage(ERROR_SOURCE_NO_TARGET, params),
    params,
  );
}

export async function handleSourceReady(job: Job<SourceReadyJob>): Promise<void> {
  const { mediaSourceId } = job.data;

  try {
    await scanSource(mediaSourceId);
  } catch (error) {
    const keyed = error instanceof KeyedError;
    const errorKey = keyed ? error.key : ERROR_SOURCE_SCAN_FAILED;
    const errorParams = keyed
      ? error.params
      : { detail: error instanceof Error ? error.message : String(error) };
    const errorMessage = keyed
      ? error.message
      : renderMessage(errorKey, errorParams);

    await deliverReport(`sourceScanFailed(${mediaSourceId})`, () =>
      fetchGraphQL<{ sourceScanFailed: boolean }>(
        `mutation ($id: Int!, $key: String!, $params: String, $msg: String!) {
          sourceScanFailed(mediaSourceId: $id, errorKey: $key, errorParams: $params, errorMessage: $msg)
        }`,
        {
          id: mediaSourceId,
          key: errorKey,
          params: errorParams ? JSON.stringify(errorParams) : undefined,
          msg: errorMessage,
        },
      ),
    );

    throw new UnrecoverableError(errorMessage);
  }
}

async function scanSource(mediaSourceId: number): Promise<void> {

  const { mediaSource } = await fetchGraphQL<MediaSourceQueryResult>(
    `query ($id: Int!) {
      mediaSource(id: $id) {
        id status downloadPath releaseTitle movieId episodeId seasonId downloadedFiles
      }
    }`,
    { id: mediaSourceId },
  );

  if (!mediaSource) {
    // No key in the frozen worker error table (docs/spec/features/018-ui-i18n/spec.md
    // § "Error table — worker") covers "mediaSource not found" — the table's three
    // api-owned keys are processJob.not_found, source.no_target and
    // source.no_download_path only. Reported in English per Article VI rather than
    // inventing a key outside the frozen contract; flagged to the orchestrator.
    throw new Error(`mediaSource ${mediaSourceId} does not exist`);
  }
  if (!mediaSource.downloadPath) {
    throw new KeyedError(
      ERROR_SOURCE_NO_DOWNLOAD_PATH,
      renderMessage(ERROR_SOURCE_NO_DOWNLOAD_PATH),
    );
  }

  const mode = selectMode(mediaSource);

  const { files: scannedFiles } = await scanFolder(mediaSource.downloadPath);
  const files = markDownloaded(scannedFiles, mediaSource.downloadedFiles, mediaSource.downloadPath);
  const matches: Match[] = selectMatches(files, mode);

  if (mediaSource.downloadedFiles === null) {
    console.log(
      `[source-ready] ${mediaSourceId}: sin información de archivos bajados — se consideran todos`,
    );
  } else {
    console.log(
      `[source-ready] ${mediaSourceId}: el cliente de torrents reportó ${mediaSource.downloadedFiles.length} archivo(s) bajado(s)`,
    );
  }

  const matchedPaths = new Set(matches.map((match) => match.filePath));
  const skipped = files.filter((file) => file.isVideo && !matchedPaths.has(file.filePath));

  console.log(
    `[source-ready] ${mediaSourceId}: ${files.length} archivo(s), ${matches.length} match(es)`,
  );
  for (const file of skipped) {
    if (!file.isDownloaded) {
      console.log(`[source-ready] ${mediaSourceId}: archivo de video no bajado — ${file.fileName}`);
    } else {
      console.log(`[source-ready] ${mediaSourceId}: archivo de video no resuelto — ${file.fileName}`);
    }
  }

  await fetchGraphQL<SourceScannedMutationResult>(
    `mutation ($id: Int!, $files: [SourceFileInput!]!, $matches: [ScannedMatchInput!]!) {
      sourceScanned(mediaSourceId: $id, files: $files, matches: $matches) { id status errorMessage }
    }`,
    { id: mediaSourceId, files, matches },
  );
}
