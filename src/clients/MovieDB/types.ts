import { MEDIA_TYPE, MediaType } from "@/types/media";

export const MOVIEDB_CLIENTS = {
  TMDB: "tmdb"
} as const;

export type MovieDBClientType =
  (typeof MOVIEDB_CLIENTS)[keyof typeof MOVIEDB_CLIENTS];


// --- Interfaces de Dominio Unificadas ---

export interface BaseMediaDetail {
  id: number;
  title: string;
  originalTitle: string;
  overview: string;
  posterPath: string | null;
  backdropPath: string | null;
  originalLanguage: string;
  voteAverage: number;
  status: string;
}

export interface MovieDetail extends BaseMediaDetail {
  type: typeof MEDIA_TYPE.MOVIE;
  releaseDate: string;
  runtime: number;
}

export interface ShowDetail extends BaseMediaDetail {
  type: typeof MEDIA_TYPE.TV;
  firstAirDate: string;
  numberOfSeasons: number;
  numberOfEpisodes: number;
}

export interface EpisodeDetail {
  id: number;
  title: string;
  overview: string;
  releaseDate: string;
  episodeNumber: number;
  voteAverage: number;
  stillPath: string | null;
}

export type MediaDetail = MovieDetail | ShowDetail;

export type MovieDBClient = {
  //fetchAllTmdbPages: <T>(params: MovieDBSearch) => Promise<T[]>,
  //fetchPage: <T>(endpoint: string, query: string, page?: number) => Promise<T[]>
  search: <T>(thing: string, query: string, page?: number) => Promise<T[]>
  details: (thing: MediaType, id: number) => Promise<MediaDetail>
  seasonDetails: (id: number, seasonNumber: number) => Promise<EpisodeDetail[]>
};


export type MovieDBSearch = {
  endpoint: string;
  query: string;
};