// Contrato compartido entre clientes de catálogo (TMDB hoy; indexer y
// mediaServer después). Los tipos crudos de cada proveedor (wire, snake_case)
// viven en clients/<proveedor>/types.ts y no se mezclan acá.

import { MEDIA_TYPE, MediaType } from '@/types/media';

export interface MovieDBSearch {
  <T>(thing: string, query: string, page?: number): Promise<T[]>;
}

export interface MovieDBClient {
  search: MovieDBSearch;
  details(thing: MediaType, id: number): Promise<MediaDetail>;
  seasonDetails(id: number, seasonNumber: number): Promise<EpisodeDetail[]>;
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

// Resultado de búsqueda ya traducido a nuestro formato (no confundir con la
// entity GraphQL de mismo nombre en movies/entities, que es la versión
// decorada con @ObjectType para exponer este mismo shape por schema).
export interface MediaSearchResult {
  id: number;
  title: string;
  releaseDate?: string | null;
  posterUrl?: string | null;
  originalLanguage: string;
  overview?: string;
  type: string;
  status?: string;
}
