// Espeja la forma que devuelve la query searchTorrents del api (no la del
// cliente interno del indexer, que vive del otro lado del contrato GraphQL).

export type TorrentLink = {
  downloadUrl: string | null;
};

export type ReleaseRanking = {
  resolutionTier: number;
  resolutionLabel: string;
  preferredGroup: boolean;
  groupLabel: string | null;
  sourceRank: number;
  sourceLabel: string;
  codecRank: number;
  codecLabel: string;
  dynamicRangeRank: number;
  dynamicRangeLabel: string;
  audioRank: number;
  audioLabel: string;
  matchedLanguage: string | null;
  sourcePromoted: boolean;
};

export type IndexerStatus = {
  configuredIndexers: number;
  reachable: boolean;
};

export type SearchTarget =
  | { movieId: number }
  | { seasonId: number }
  | { episodeId: number };

export type TorrentResult = {
  id: string;
  infoHash: string | null;
  title: string | null;
  size: number | null;
  seeders: number;
  leechers: number;
  items: TorrentLink[];
  infoUrl: TorrentLink[];
  ranking: ReleaseRanking;
  candidate: boolean;
  candidateRank: number | null;
};
