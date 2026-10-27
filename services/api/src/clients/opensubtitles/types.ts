// Spec 107, REQ-5
export type OsLoginResponse = {
  token?: string;
  base_url?: string;
};

export type OsSession = { token: string; baseUrl: string };

export type OsFile = { file_id: number; file_name?: string };

export type OsSubtitleAttributes = {
  release?: string;
  download_count?: number;
  hearing_impaired?: boolean;
  foreign_parts_only?: boolean;
  machine_translated?: boolean;
  ai_translated?: boolean;
  moviehash_match?: boolean;
  files?: OsFile[];
};

export type OsSearchResponse = {
  data?: Array<{ id?: string; attributes?: OsSubtitleAttributes }>;
};

export type OsDownloadResponse = {
  link?: string;
  remaining?: number;
};

// Spec 107, REQ-6
export type OsSearchParams = {
  languages: string;
  moviehash?: string | null;
} & (
  | { tmdbId: number }
  | { parentTmdbId: number; season: number; episode: number }
);
