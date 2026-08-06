'use server'

import { fetchGraphQL } from '@/lib/graphql-client';
import { TorrentResult } from '@/types/indexer';

const SEARCH_TORRENTS_QUERY = `
  query SearchTorrents($query: String!) {
    searchTorrents(query: $query) {
      infoHash
      title
      size
      seeders
      leechers
      items { downloadUrl }
      infoUrl { downloadUrl }
    }
  }
`;

export async function searchTorrentsAction(query: string): Promise<TorrentResult[]> {
  if (!query.trim()) return [];

  const { data, errors } = await fetchGraphQL<{ searchTorrents: TorrentResult[] }>(
    SEARCH_TORRENTS_QUERY,
    { query },
  );

  if (errors && errors.length > 0) {
    throw new Error(errors[0]?.message || 'Error al buscar releases');
  }

  return data?.searchTorrents ?? [];
}

const ADD_TORRENT_MUTATION = `
  mutation AddTorrentToMovie($movieId: Int!, $infoHash: String!, $urls: [String!]!, $releaseTitle: String, $force: Boolean) {
    addTorrentToMovie(movieId: $movieId, infoHash: $infoHash, urls: $urls, releaseTitle: $releaseTitle, force: $force) {
      id
      status
    }
  }
`;

export async function addTorrentToMovieAction(
  movieId: number,
  infoHash: string,
  urls: string[],
  releaseTitle: string | null,
  force = false,
): Promise<{ id: number; status: string }> {
  const { data, errors } = await fetchGraphQL<{ addTorrentToMovie: { id: number; status: string } }>(
    ADD_TORRENT_MUTATION,
    { movieId, infoHash, urls, releaseTitle, force },
  );

  if (errors && errors.length > 0) {
    throw new Error(errors[0]?.message || 'Error al agregar el torrent');
  }

  return data!.addTorrentToMovie;
}
