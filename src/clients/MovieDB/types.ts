export const MOVIEDB_CLIENTS = {
  TMDB: "tmdb"
} as const;

export type MovieDBClientType =
  (typeof MOVIEDB_CLIENTS)[keyof typeof MOVIEDB_CLIENTS];

export type MovieDBClient = {
  //fetchAllTmdbPages: <T>(params: MovieDBSearch) => Promise<T[]>,
  //fetchPage: <T>(endpoint: string, query: string, page?: number) => Promise<T[]>
  search: <T>(thing: string, query: string, page?: number) => Promise<T[]>
};


export type MovieDBSearch = {
  endpoint: string;
  query: string;
};