import type { Job } from 'bullmq';
import { fetchGraphQL } from '../api/graphql-client';
import { scanFolder } from '../scan/scan-folder';
import { selectMatches, type Match, type SelectMatchesMode } from '../scan/select-matches';
import type { SourceReadyJob } from '../queue/types';
import { KeyedError } from '../i18n/keyed-error';
import { renderMessage } from '../i18n/messages.en';
import { ERROR_SOURCE_NO_DOWNLOAD_PATH, ERROR_SOURCE_NO_TARGET } from '../i18n/error-keys';

type MediaSourceQueryResult = {
  mediaSource: {
    id: number;
    status: string;
    downloadPath: string | null;
    releaseTitle: string | null;
    movieId: number | null;
    episodeId: number | null;
    seasonId: number | null;
  } | null;
};

type SourceScannedMutationResult = {
  sourceScanned: {
    id: number;
    status: string;
    errorMessage: string | null;
  };
};

// Picks the scan mode from data the API returns, never from the shape of the
// download directory (REQ-1). A source targeting neither a film, an episode
// nor a season is an error — the job fails loudly rather than silently
// scanning nothing.
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

  const { mediaSource } = await fetchGraphQL<MediaSourceQueryResult>(
    `query ($id: Int!) {
      mediaSource(id: $id) { id status downloadPath releaseTitle movieId episodeId seasonId }
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

  const { files } = await scanFolder(mediaSource.downloadPath);
  const matches: Match[] = selectMatches(files, mode);

  const matchedPaths = new Set(matches.map((match) => match.filePath));
  const skipped = files.filter((file) => file.isVideo && !matchedPaths.has(file.filePath));

  console.log(
    `[source-ready] ${mediaSourceId}: ${files.length} archivo(s), ${matches.length} match(es)`,
  );
  for (const file of skipped) {
    console.log(`[source-ready] ${mediaSourceId}: archivo de video no resuelto — ${file.fileName}`);
  }

  await fetchGraphQL<SourceScannedMutationResult>(
    `mutation ($id: Int!, $files: [SourceFileInput!]!, $matches: [ScannedMatchInput!]!) {
      sourceScanned(mediaSourceId: $id, files: $files, matches: $matches) { id status errorMessage }
    }`,
    { id: mediaSourceId, files, matches },
  );
}
