export const INDEXER_CLIENTS = {
  PROWLARR: "prowlarr",
  JACKETT: "jackett",
} as const;

export type IndexerClientType =
  (typeof INDEXER_CLIENTS)[keyof typeof INDEXER_CLIENTS];

export interface TorrentResult {
  id: string;
  infoHash: string | null;
  title: string | null;
  size: number | null;
  seeders: number;
  leechers: number;
  items: {
    downloadUrl: string | null;
  }[];
  infoUrl: {
    downloadUrl: string | null;
  }[];
}

export type IndexerClient = {
  search: (query: string) => Promise<TorrentResult[]>;
  //searchIA: (query: string) => Promise<TorrentResult[]>;
};