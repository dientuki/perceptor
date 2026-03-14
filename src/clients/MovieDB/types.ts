export const MOVIEDB_CLIENTS = {
  TMDB: "tmdb"
} as const;

export type MovieDBClientType =
  (typeof MOVIEDB_CLIENTS)[keyof typeof MOVIEDB_CLIENTS];

export type MovieDBClient = {
  fetchAllTmdbPages: (params: MovieDBSearch) => Promise<MovieDBResults[]>
};


export type MovieDBSearch = {
  endpoint: string;
  query: string;
};

export type MovieDBResults = {
};