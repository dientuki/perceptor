// Formas crudas que devuelve la API de TMDB (snake_case, tal cual el wire).
// La traducción a nuestro dominio vive en ./client.ts y en movies.service.ts.

export interface TmdbSearchResponse<T> {
  page: number;
  results: T[];
  total_pages: number;
  total_results: number;
}

export interface TmdbBase {
  adult: boolean;
  backdrop_path: string;
  genre_ids: number[];
  id: number;
  original_language: string;
  overview: string;
  popularity: number;
  poster_path: string | null;
  vote_average: number;
  vote_count: number;
}

export interface TmdbMovie extends TmdbBase {
  original_title: string;
  release_date: string;       // Fecha de estreno
  title: string;
  video: boolean;
}

// Interfaces Específicas de Detalles (TMDB devuelve campos extra en endpoints de detalle)
export interface TmdbMovieDetails extends TmdbMovie {
  runtime: number;
  status: string;
}

export interface TmdbShow extends TmdbBase {
  origin_country: string[];   // Países de origen
  original_name: string;
  first_air_date: string;
  name: string;
}

export interface TmdbSeason {
  air_date: string;
  episode_count: number;
  id: number;
  name: string;
  overview: string;
  poster_path: string;
  season_number: number;
  vote_average: number;
}

export interface TmdbShowDetails extends TmdbShow {
  number_of_episodes: number;
  number_of_seasons: number;
  status: string;
  seasons: TmdbSeason[];
}

export interface TmdbEpisode {
  id: number;
  name: string;
  overview: string;
  air_date: string;
  episode_number: number;
  still_path: string | null;
  vote_average: number;
}

export interface TmdbSeasonDetails {
  episodes: TmdbEpisode[];
}
