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

// Spec 112: raw Prowlarr shapes, loosely typed; the catalog module validates them.
export type ProwlarrSchemaEntry = import('@/indexer/indexer-catalog').SchemaEntry;

export interface ProwlarrIndexer {
  id: number;
  name?: string;
  definitionName?: string;
  tags?: number[];
  [key: string]: unknown;
}

export interface ProwlarrTag {
  id: number;
  label: string;
}

export interface ProwlarrAppProfile {
  id: number;
  [key: string]: unknown;
}

export type IndexerClient = {
  search: (query: string) => Promise<TorrentResult[]>;
  countIndexers: () => Promise<number>;
  getIndexerSchema: () => Promise<ProwlarrSchemaEntry[]>;
  listIndexers: () => Promise<ProwlarrIndexer[]>;
  createIndexer: (body: Record<string, unknown>) => Promise<ProwlarrIndexer>;
  deleteIndexer: (id: number) => Promise<void>;
  listTags: () => Promise<ProwlarrTag[]>;
  listAppProfiles: () => Promise<ProwlarrAppProfile[]>;
  //searchIA: (query: string) => Promise<TorrentResult[]>;
};