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
