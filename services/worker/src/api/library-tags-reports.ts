import { fetchGraphQL } from './graphql-client';

export interface LibraryTagMigrationTrack {
  source: string;
  provider: string | null;
  syncScore: number | null;
  framerateRatio: number | null;
  embeddedAt: string | null;
}

export interface LibraryTagMigrationItemDetails {
  id: number;
  filePath: string;
  encodedAt: string | null;
  videoCodec: string | null;
  crf: number | null;
  preset: number | null;
  contentKind: string | null;
  resolutionCeiling: string | null;
  outputResolution: string | null;
  grainApplied: boolean | null;
  deinterlaced: boolean | null;
  dubTrimSeconds: number | null;
  streamEndTrimSeconds: number | null;
  tracks: LibraryTagMigrationTrack[];
}

export type LibraryTagWorkerOutcome = 'MIGRATED' | 'UNCHANGED' | 'MISSING' | 'FAILED';

// Spec 123, REQ-17
export async function libraryTagMigrationItem(
  id: number,
): Promise<LibraryTagMigrationItemDetails> {
  const data = await fetchGraphQL<{ libraryTagMigrationItem: LibraryTagMigrationItemDetails }>(
    `query ($id: Int!) {
      libraryTagMigrationItem(id: $id) {
        id
        filePath
        encodedAt
        videoCodec
        crf
        preset
        contentKind
        resolutionCeiling
        outputResolution
        grainApplied
        deinterlaced
        dubTrimSeconds
        streamEndTrimSeconds
        tracks {
          source
          provider
          syncScore
          framerateRatio
          embeddedAt
        }
      }
    }`,
    { id },
  );
  return data.libraryTagMigrationItem;
}

// Spec 123, REQ-17
export async function libraryTagMigrationItemFinished(
  id: number,
  outcome: LibraryTagWorkerOutcome,
  reasonKey: string | null,
): Promise<boolean> {
  const data = await fetchGraphQL<{ libraryTagMigrationItemFinished: boolean }>(
    `mutation ($id: Int!, $outcome: LibraryTagOutcome!, $reasonKey: String) {
      libraryTagMigrationItemFinished(id: $id, outcome: $outcome, reasonKey: $reasonKey)
    }`,
    { id, outcome, reasonKey },
  );
  return data.libraryTagMigrationItemFinished;
}
