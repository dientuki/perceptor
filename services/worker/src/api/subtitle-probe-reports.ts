import { fetchGraphQL } from './graphql-client';

export interface SubtitleProbeDetails {
  id: number;
  filePath: string;
}

// Spec 107, T012
export async function subtitleProbeDetails(id: number): Promise<SubtitleProbeDetails> {
  const data = await fetchGraphQL<{ subtitleProbeDetails: SubtitleProbeDetails }>(
    `query ($id: Int!) {
      subtitleProbeDetails(id: $id) {
        id
        filePath
      }
    }`,
    { id },
  );
  return data.subtitleProbeDetails;
}

// Spec 107, T012
export async function subtitleProbeStarted(id: number): Promise<boolean> {
  const data = await fetchGraphQL<{ subtitleProbeStarted: boolean }>(
    `mutation ($id: Int!) { subtitleProbeStarted(id: $id) }`,
    { id },
  );
  return data.subtitleProbeStarted;
}

// Spec 107, T012
export async function subtitleProbeCompleted(
  id: number,
  embeddedLanguagesIso3: string[],
  sidecarLanguageTags: string[],
  fileSizeBytes: number,
  movieHash: string,
): Promise<boolean> {
  const data = await fetchGraphQL<{ subtitleProbeCompleted: boolean }>(
    `mutation ($id: Int!, $embeddedLanguagesIso3: [String!]!, $sidecarLanguageTags: [String!]!, $fileSizeBytes: Float!, $movieHash: String!) {
      subtitleProbeCompleted(id: $id, embeddedLanguagesIso3: $embeddedLanguagesIso3, sidecarLanguageTags: $sidecarLanguageTags, fileSizeBytes: $fileSizeBytes, movieHash: $movieHash)
    }`,
    { id, embeddedLanguagesIso3, sidecarLanguageTags, fileSizeBytes, movieHash },
  );
  return data.subtitleProbeCompleted;
}

// Spec 107, T012
export async function subtitleProbeFailed(id: number, errorKey: string): Promise<boolean> {
  const data = await fetchGraphQL<{ subtitleProbeFailed: boolean }>(
    `mutation ($id: Int!, $errorKey: String!) {
      subtitleProbeFailed(id: $id, errorKey: $errorKey)
    }`,
    { id, errorKey },
  );
  return data.subtitleProbeFailed;
}
