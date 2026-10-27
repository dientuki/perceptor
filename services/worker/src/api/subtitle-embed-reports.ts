import { fetchGraphQL } from './graphql-client';

export interface SubtitleEmbedTrackDetails {
  sourcePath: string;
  languageIso3: string;
  trackTitle: string;
  isDefault: boolean;
  isForced: boolean;
  offsetMs: number;
  // Spec 103, REQ-11
  isSidecar?: boolean;
  // Spec 107, REQ-14
  provenance?: string;
}

export interface SubtitleEmbedDetails {
  id: number;
  filePath: string;
  tracks: SubtitleEmbedTrackDetails[];
}

// Spec 101, REQ-13
export async function subtitleEmbedDetails(id: number): Promise<SubtitleEmbedDetails> {
  const data = await fetchGraphQL<{ subtitleEmbedDetails: SubtitleEmbedDetails }>(
    `query ($id: Int!) {
      subtitleEmbedDetails(id: $id) {
        id
        filePath
        tracks { sourcePath languageIso3 trackTitle isDefault isForced offsetMs isSidecar provenance }
      }
    }`,
    { id },
  );
  return {
    ...data.subtitleEmbedDetails,
    tracks: data.subtitleEmbedDetails.tracks.map((track) => ({
      ...track,
      isSidecar: track.isSidecar ?? true,
    })),
  };
}

// Spec 101, REQ-10
export async function subtitleEmbedStarted(id: number): Promise<boolean> {
  const data = await fetchGraphQL<{ subtitleEmbedStarted: boolean }>(
    `mutation ($id: Int!) { subtitleEmbedStarted(id: $id) }`,
    { id },
  );
  return data.subtitleEmbedStarted;
}

// Spec 101, REQ-12
export async function subtitleEmbedCompleted(
  id: number,
  warningKey: string | null,
): Promise<boolean> {
  const data = await fetchGraphQL<{ subtitleEmbedCompleted: boolean }>(
    `mutation ($id: Int!, $warningKey: String) {
      subtitleEmbedCompleted(id: $id, warningKey: $warningKey)
    }`,
    { id, warningKey },
  );
  return data.subtitleEmbedCompleted;
}

// Spec 101, REQ-10
export async function subtitleEmbedFailed(id: number, errorKey: string): Promise<boolean> {
  const data = await fetchGraphQL<{ subtitleEmbedFailed: boolean }>(
    `mutation ($id: Int!, $errorKey: String!) {
      subtitleEmbedFailed(id: $id, errorKey: $errorKey)
    }`,
    { id, errorKey },
  );
  return data.subtitleEmbedFailed;
}
