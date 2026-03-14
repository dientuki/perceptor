export const INDEXER_CLIENTS = {
  PROWLARR: "prowlarr"
} as const;

export type IndexerClientType =
  (typeof INDEXER_CLIENTS)[keyof typeof INDEXER_CLIENTS];

export type IndexerClient = {
  search: (query: string) => Promise<TorrentInfo>;
};

export type TorrentInfo = {
  downloadUrl: string;
  infoHash: string;
};