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

export type IndexerMediaCategory = "MOVIES" | "TV" | "ANIME";

export type IndexerDefinition = {
  definitionName: string;
  name: string;
  language: string | null;
  categories: IndexerMediaCategory[];
  needsFlareSolverr: boolean;
  configured: boolean;
};

export type ConfiguredIndexer = {
  id: string;
  name: string;
  definitionName: string;
  enabled: boolean;
  usesFlareSolverr: boolean;
};

export type IndexerActionError = {
  ok: false;
  error: string;
  errorKey?: string;
};
