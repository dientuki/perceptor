import { fetchGraphQL } from './graphql-client';
import type { SubtitleSyncReference } from './subtitle-sync-reports';

export interface SubtitleEmbedSyncDetails {
  subtitleEmbedId: number;
  fileName: string;
  filePath: string;
  candidatePath: string;
}

// Spec 113, T009
export async function subtitleEmbedSyncDetails(
  subtitleEmbedId: number,
  fileName: string,
): Promise<SubtitleEmbedSyncDetails> {
  const data = await fetchGraphQL<{ subtitleEmbedSyncDetails: SubtitleEmbedSyncDetails }>(
    `query ($subtitleEmbedId: Int!, $fileName: String!) {
      subtitleEmbedSyncDetails(subtitleEmbedId: $subtitleEmbedId, fileName: $fileName) {
        subtitleEmbedId
        fileName
        filePath
        candidatePath
      }
    }`,
    { subtitleEmbedId, fileName },
  );
  return data.subtitleEmbedSyncDetails;
}

// Spec 113, T009
export async function subtitleEmbedSyncCompleted(
  subtitleEmbedId: number,
  fileName: string,
  offsetMs: number,
  framerateRatio: number,
  reference: SubtitleSyncReference,
  score: number,
  mediaDurationMs: number,
  lastChapterStartMs: number | null,
): Promise<boolean> {
  const data = await fetchGraphQL<{ subtitleEmbedSyncCompleted: boolean }>(
    `mutation ($subtitleEmbedId: Int!, $fileName: String!, $offsetMs: Int!, $framerateRatio: Float!, $reference: SubtitleSyncReference!, $score: Float!, $mediaDurationMs: Int!, $lastChapterStartMs: Int) {
      subtitleEmbedSyncCompleted(subtitleEmbedId: $subtitleEmbedId, fileName: $fileName, offsetMs: $offsetMs, framerateRatio: $framerateRatio, reference: $reference, score: $score, mediaDurationMs: $mediaDurationMs, lastChapterStartMs: $lastChapterStartMs)
    }`,
    {
      subtitleEmbedId,
      fileName,
      offsetMs,
      framerateRatio,
      reference,
      score,
      mediaDurationMs,
      lastChapterStartMs,
    },
  );
  return data.subtitleEmbedSyncCompleted;
}

// Spec 113, T009
export async function subtitleEmbedSyncFailed(
  subtitleEmbedId: number,
  fileName: string,
  errorKey: string,
): Promise<boolean> {
  const data = await fetchGraphQL<{ subtitleEmbedSyncFailed: boolean }>(
    `mutation ($subtitleEmbedId: Int!, $fileName: String!, $errorKey: String!) {
      subtitleEmbedSyncFailed(subtitleEmbedId: $subtitleEmbedId, fileName: $fileName, errorKey: $errorKey)
    }`,
    { subtitleEmbedId, fileName, errorKey },
  );
  return data.subtitleEmbedSyncFailed;
}
