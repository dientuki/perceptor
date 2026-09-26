'use server'

import { redirectIfUnauthenticated } from '@/lib/auth-session';
import { fetchGraphQL } from '@/lib/graphql-client';
import { toActionError, translateGraphQLError } from '@/lib/graphql-error';
import type { SearchTarget, TorrentResult } from '@/types/indexer';
import type { AcquisitionResult } from '@/types/media';

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
