import type { Job } from 'bullmq';
import { fetchGraphQL } from '../api/graphql-client';
import { scanFolder } from '../scan/scan-folder';
import type { SourceReadyJob } from '../queue/types';

type MediaSourceQueryResult = {
  mediaSource: {
    id: number;
    status: string;
    downloadPath: string | null;
    releaseTitle: string | null;
    movieId: number | null;
    episodeId: number | null;
  } | null;
};

type SourceScannedMutationResult = {
  sourceScanned: {
    id: number;
    status: string;
    errorMessage: string | null;
  };
};

export async function handleSourceReady(job: Job<SourceReadyJob>): Promise<void> {
  const { mediaSourceId } = job.data;

  const { mediaSource } = await fetchGraphQL<MediaSourceQueryResult>(
    `query ($id: Int!) {
      mediaSource(id: $id) { id status downloadPath releaseTitle movieId episodeId }
    }`,
    { id: mediaSourceId },
  );

  if (!mediaSource) {
    throw new Error(`mediaSource ${mediaSourceId} no existe`);
  }
  if (!mediaSource.downloadPath) {
    throw new Error(`mediaSource ${mediaSourceId} no tiene downloadPath`);
  }

  const { files, matchedFilePath } = await scanFolder(mediaSource.downloadPath);

  console.log(
    `[source-ready] ${mediaSourceId}: ${files.length} archivo(s), match ${matchedFilePath}`,
  );

  await fetchGraphQL<SourceScannedMutationResult>(
    `mutation ($id: Int!, $files: [SourceFileInput!]!, $matched: String) {
      sourceScanned(mediaSourceId: $id, files: $files, matchedFilePath: $matched) { id status errorMessage }
    }`,
    { id: mediaSourceId, files, matched: matchedFilePath },
  );
}
