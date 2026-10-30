'use server'

import {
  redirectIfUnauthenticated,
  redirectToClearSession,
} from '@/lib/auth-session';
import { fetchGraphQL } from '@/lib/graphql-client';
import { toActionError, translateGraphQLError } from '@/lib/graphql-error';
import type {
  ConfiguredIndexer,
  IndexerActionError,
  IndexerDefinition,
  IndexerStatus,
  SearchTarget,
  TorrentResult,
} from '@/types/indexer';
import type { AcquisitionResult } from '@/types/media';

const INDEXER_STATUS_QUERY = `
  query IndexerStatus {
    indexerStatus {
      configuredIndexers
      reachable
    }
  }
`;

// Called from a Server Component's render pass (the first-step page) —
// cookie mutation is illegal there, so hand off to the Route Handler instead.
export async function getIndexerStatus(): Promise<IndexerStatus> {
  const { data, errors } = await fetchGraphQL<{ indexerStatus: IndexerStatus }>(
    INDEXER_STATUS_QUERY,
  );

  if (errors && errors.length > 0) {
    redirectToClearSession(errors);
    throw new Error(await translateGraphQLError(errors[0]));
  }

  return data?.indexerStatus ?? { configuredIndexers: 0, reachable: false };
}

const SEARCH_TORRENTS_QUERY = `
  query SearchTorrents($query: String!, $movieId: Int, $seasonId: Int, $episodeId: Int) {
    searchTorrents(query: $query, movieId: $movieId, seasonId: $seasonId, episodeId: $episodeId) {
      id
      infoHash
      title
      size
      seeders
      leechers
      items { downloadUrl }
      infoUrl { downloadUrl }
      ranking {
        resolutionTier
        resolutionLabel
        preferredGroup
        groupLabel
        sourceRank
        sourceLabel
        codecRank
        codecLabel
        dynamicRangeRank
        dynamicRangeLabel
        audioRank
        audioLabel
        matchedLanguage
        sourcePromoted
      }
      candidate
      candidateRank
    }
  }
`;

export async function searchTorrentsAction(
  query: string,
  target: SearchTarget | null = null,
): Promise<TorrentResult[]> {
  if (!query.trim()) return [];

  const { data, errors } = await fetchGraphQL<{ searchTorrents: TorrentResult[] }>(
    SEARCH_TORRENTS_QUERY,
    { query, ...target },
  );

  if (errors && errors.length > 0) {
    await redirectIfUnauthenticated(errors);
    throw new Error(await translateGraphQLError(errors[0]));
  }

  return data?.searchTorrents ?? [];
}

const ADD_TORRENT_MUTATION = `
  mutation AddTorrentToMovie($movieId: Int!, $infoHash: String, $urls: [String!]!, $releaseTitle: String, $force: Boolean) {
    addTorrentToMovie(movieId: $movieId, infoHash: $infoHash, urls: $urls, releaseTitle: $releaseTitle, force: $force) {
      id
      status
    }
  }
`;

export async function addTorrentToMovieAction(
  movieId: number,
  infoHash: string | null,
  urls: string[],
  releaseTitle: string | null,
  force = false,
): Promise<AcquisitionResult> {
  const { data, errors } = await fetchGraphQL<{ addTorrentToMovie: { id: number; status: string } }>(
    ADD_TORRENT_MUTATION,
    { movieId, infoHash, urls, releaseTitle, force },
  );

  if (errors && errors.length > 0) {
    await redirectIfUnauthenticated(errors);
    return await toActionError(errors[0]);
  }

  return { success: true, ...data!.addTorrentToMovie };
}

const INDEXER_CATALOG_QUERY = `
  query IndexerCatalog($search: String) {
    indexerCatalog(search: $search) {
      definitionName
      name
      language
      categories
      needsFlareSolverr
      configured
    }
  }
`;

const CONFIGURED_INDEXERS_QUERY = `
  query ConfiguredIndexers {
    configuredIndexers {
      id
      name
      definitionName
      enabled
      usesFlareSolverr
    }
  }
`;

const ADD_INDEXER_MUTATION = `
  mutation AddIndexer($definitionName: String!) {
    addIndexer(definitionName: $definitionName) {
      id
      name
      definitionName
      enabled
      usesFlareSolverr
    }
  }
`;

const REMOVE_INDEXER_MUTATION = `
  mutation RemoveIndexer($id: Int!) {
    removeIndexer(id: $id)
  }
`;

// Spec 112, REQ-12
export async function getIndexerCatalogAction(
  search: string,
): Promise<{ ok: true; data: IndexerDefinition[] } | IndexerActionError> {
  const { data, errors } = await fetchGraphQL<{
    indexerCatalog: IndexerDefinition[];
  }>(INDEXER_CATALOG_QUERY, { search: search.trim() || null });

  if (errors && errors.length > 0) {
    await redirectIfUnauthenticated(errors);
    return { ok: false, ...(await toActionError(errors[0])) };
  }

  return { ok: true, data: data?.indexerCatalog ?? [] };
}

// Spec 112, REQ-9
export async function getConfiguredIndexersAction(): Promise<
  { ok: true; data: ConfiguredIndexer[] } | IndexerActionError
> {
  const { data, errors } = await fetchGraphQL<{
    configuredIndexers: ConfiguredIndexer[];
  }>(CONFIGURED_INDEXERS_QUERY);

  if (errors && errors.length > 0) {
    await redirectIfUnauthenticated(errors);
    return { ok: false, ...(await toActionError(errors[0])) };
  }

  return { ok: true, data: data?.configuredIndexers ?? [] };
}

// Spec 112, REQ-5
export async function addIndexerAction(
  definitionName: string,
): Promise<{ ok: true; data: ConfiguredIndexer } | IndexerActionError> {
  const { data, errors } = await fetchGraphQL<{
    addIndexer: ConfiguredIndexer;
  }>(ADD_INDEXER_MUTATION, { definitionName });

  if (errors && errors.length > 0) {
    await redirectIfUnauthenticated(errors);
    return { ok: false, ...(await toActionError(errors[0])) };
  }

  if (!data?.addIndexer) {
    return { ok: false, error: 'No se pudo agregar el indexer' };
  }

  return { ok: true, data: data.addIndexer };
}

// Spec 112, REQ-10
export async function removeIndexerAction(
  id: string,
): Promise<{ ok: true } | IndexerActionError> {
  const { errors } = await fetchGraphQL<{ removeIndexer: boolean }>(
    REMOVE_INDEXER_MUTATION,
    { id: Number(id) },
  );

  if (errors && errors.length > 0) {
    await redirectIfUnauthenticated(errors);
    return { ok: false, ...(await toActionError(errors[0])) };
  }

  return { ok: true };
}
