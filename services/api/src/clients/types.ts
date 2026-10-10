import { MEDIA_TYPE, MediaType } from '@/types/media';

export interface MovieDBSearch {
  <T>(thing: string, query: string, page?: number): Promise<T[]>;
}

export interface MovieReleaseDates {
  earliest: string | null;
  theatrical: string | null;
  digital: string | null;
  physical: string | null;
}

export interface MovieDBClient {
  search: MovieDBSearch;
  details(thing: MediaType, id: number): Promise<MediaDetail>;
  seasonDetails(id: number, seasonNumber: number): Promise<EpisodeDetail[]>;
  movieReleaseDates(id: number): Promise<MovieReleaseDates>;
  // 057-content-kind-classification: TMDB's own keywords response asymmetry
  // (a film body nests them under `keywords`, a series body under `results`)
  // is absorbed here — the caller always gets a flat list of keyword ids, or
  // an empty one when neither shape matched.
  keywords(thing: MediaType, id: number): Promise<number[]>;
}

export interface BaseMediaDetail {
  id: number;
  title: string;
  originalTitle: string;
  overview: string;
  posterPath: string | null;
  backdropPath: string;
  originalLanguage: string;
  voteAverage: number;
  status: string;
}

export interface MovieDetail extends BaseMediaDetail {
  type: typeof MEDIA_TYPE.MOVIE;
  releaseDate: string;
  runtime: number;
  genreIds: number[];
}

export interface SeasonSummary {
  id: number;
  name: string;
  seasonNumber: number;
  episodeCount: number;
  releaseDate: string;
  overview: string;
  posterPath: string;
}

export interface ShowDetail extends BaseMediaDetail {
  type: typeof MEDIA_TYPE.SHOW;
  firstAirDate: string;
  numberOfSeasons: number;
  numberOfEpisodes: number;
  seasons: SeasonSummary[];
  genreIds: number[];
}

export type MediaDetail = MovieDetail | ShowDetail;

export interface EpisodeDetail {
  id: number;
  title: string;
  overview: string;
  releaseDate: string;
  episodeNumber: number;
  stillPath: string | null;
  voteAverage: number;
}

export interface MediaSearchResult {
  id: number;
  title: string;
  releaseDate?: string | null;
  posterUrl?: string | null;
  originalLanguage: string;
  overview?: string;
  type: string;
  status?: string;
  // Spec 056, NFR-1
  runtime?: number | null;
  // 057-content-kind-classification: TMDB genre/keyword ids, carried through
  // the same warm cache entry runtime already uses. Present on a search
  // result (TMDB's search/multi/popular rows all carry genre_ids); a
  // registration tops the entry up with keywordIds only for an animated
  // title (see MoviesService/ShowsService content-kind derivation) — never
  // written for a live-action one, so most cache entries never grow this.
  genreIds?: number[];
  keywordIds?: number[];
  earliestReleaseDate?: string | null;
  theatricalReleaseDate?: string | null;
  digitalReleaseDate?: string | null;
  physicalReleaseDate?: string | null;
  tmdbStatus?: string | null;
}
