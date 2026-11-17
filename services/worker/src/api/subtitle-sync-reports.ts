import { fetchGraphQL } from './graphql-client';

export type SubtitleSyncReference = 'SUBTITLE' | 'AUDIO';

export interface SubtitleSyncDetails {
  id: number;
  filePath: string;
  candidatePath: string;
  variantDetectionIso3: string | null;
}

// Spec 103, REQ-10
export async function subtitleSyncDetails(id: number): Promise<SubtitleSyncDetails> {
  const data = await fetchGraphQL<{ subtitleSyncDetails: Omit<SubtitleSyncDetails, 'variantDetectionIso3'> & { variantDetectionIso3?: string | null } }>(
    `query ($id: Int!) {
      subtitleSyncDetails(id: $id) {
        id
        filePath
        candidatePath
        variantDetectionIso3
      }
    }`,
    { id },
  );
  const details = data.subtitleSyncDetails;
  if (details.variantDetectionIso3 === undefined) {
    console.warn(`[subtitle-sync] ${id} details carry no variantDetectionIso3, reading it as null`);
  }
  return { ...details, variantDetectionIso3: details.variantDetectionIso3 ?? null };
}

// Spec 103, REQ-10
export async function subtitleSyncStarted(id: number): Promise<boolean> {
  const data = await fetchGraphQL<{ subtitleSyncStarted: boolean }>(
    `mutation ($id: Int!) { subtitleSyncStarted(id: $id) }`,
    { id },
  );
  return data.subtitleSyncStarted;
}

// Spec 103, REQ-10
export async function subtitleSyncCompleted(
  id: number,
  offsetMs: number,
  framerateRatio: number,
  reference: SubtitleSyncReference,
  score: number,
  mediaDurationMs: number,
  lastChapterStartMs: number | null,
  variantTag: string | null,
): Promise<boolean> {
  const data = await fetchGraphQL<{ subtitleSyncCompleted: boolean }>(
    `mutation ($id: Int!, $offsetMs: Int!, $framerateRatio: Float!, $reference: SubtitleSyncReference!, $score: Float!, $mediaDurationMs: Int!, $lastChapterStartMs: Int, $variantTag: String) {
      subtitleSyncCompleted(id: $id, offsetMs: $offsetMs, framerateRatio: $framerateRatio, reference: $reference, score: $score, mediaDurationMs: $mediaDurationMs, lastChapterStartMs: $lastChapterStartMs, variantTag: $variantTag)
    }`,
    { id, offsetMs, framerateRatio, reference, score, mediaDurationMs, lastChapterStartMs, variantTag },
  );
  return data.subtitleSyncCompleted;
}

// Spec 103, REQ-10
export async function subtitleSyncFailed(id: number, errorKey: string): Promise<boolean> {
  const data = await fetchGraphQL<{ subtitleSyncFailed: boolean }>(
    `mutation ($id: Int!, $errorKey: String!) {
      subtitleSyncFailed(id: $id, errorKey: $errorKey)
    }`,
    { id, errorKey },
  );
  return data.subtitleSyncFailed;
}
