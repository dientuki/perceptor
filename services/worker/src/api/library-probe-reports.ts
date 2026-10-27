import { fetchGraphQL } from './graphql-client';

export interface LibraryProbeTarget {
  movieId?: number;
  episodeId?: number;
}

export interface LibraryProbeDetails {
  filePath: string;
}

// Spec 108, T008
export async function libraryProbeDetails(
  target: LibraryProbeTarget,
): Promise<LibraryProbeDetails> {
  const data = await fetchGraphQL<{ libraryProbeDetails: LibraryProbeDetails }>(
    `query ($target: LibraryProbeTarget!) {
      libraryProbeDetails(target: $target) {
        filePath
      }
    }`,
    { target },
  );
  return data.libraryProbeDetails;
}

// Spec 108, T008
export async function libraryProbeCompleted(
  target: LibraryProbeTarget,
  filePath: string,
  audioLanguagesIso3: string[],
  embeddedSubtitleLanguagesIso3: string[],
  sidecarLanguageTags: string[],
): Promise<boolean> {
  const data = await fetchGraphQL<{ libraryProbeCompleted: boolean }>(
    `mutation ($target: LibraryProbeTarget!, $filePath: String!, $audioLanguagesIso3: [String!]!, $embeddedSubtitleLanguagesIso3: [String!]!, $sidecarLanguageTags: [String!]!) {
      libraryProbeCompleted(target: $target, filePath: $filePath, audioLanguagesIso3: $audioLanguagesIso3, embeddedSubtitleLanguagesIso3: $embeddedSubtitleLanguagesIso3, sidecarLanguageTags: $sidecarLanguageTags)
    }`,
    { target, filePath, audioLanguagesIso3, embeddedSubtitleLanguagesIso3, sidecarLanguageTags },
  );
  return data.libraryProbeCompleted;
}
