import { fetchGraphQL } from './graphql-client';

export type SubtitleSyncReference = 'SUBTITLE' | 'AUDIO';

export interface SubtitleSyncDetails {
  id: number;
  filePath: string;
  candidatePath: string;
}

// Spec 103, REQ-10
export async function subtitleSyncDetails(id: number): Promise<SubtitleSyncDetails> {
  const data = await fetchGraphQL<{ subtitleSyncDetails: SubtitleSyncDetails }>(
    `query ($id: Int!) {
      subtitleSyncDetails(id: $id) {
        id
        filePath
        candidatePath
      }
    }`,
    { id },
  );
  return data.subtitleSyncDetails;
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
): Promise<boolean> {
  const data = await fetchGraphQL<{ subtitleSyncCompleted: boolean }>(
    `mutation ($id: Int!, $offsetMs: Int!, $framerateRatio: Float!, $reference: SubtitleSyncReference!, $score: Float!) {
      subtitleSyncCompleted(id: $id, offsetMs: $offsetMs, framerateRatio: $framerateRatio, reference: $reference, score: $score)
    }`,
    { id, offsetMs, framerateRatio, reference, score },
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
