import { Injectable } from '@nestjs/common';
import {
  TmdbSearchResponse,
  TmdbMovie,
  TmdbMovieDetails,
  TmdbShow,
  TmdbShowDetails,
  TmdbSeasonDetails,
  TmdbMultiSearchResult,
} from './types';
import { mapMultiSearchResults } from './multi';
import { mapPopularMovies, mapPopularShows } from './popular';
import { MovieDBClient, MediaDetail, MediaSearchResult, ShowDetail, MovieDetail, EpisodeDetail } from '@/clients/types';
import { MEDIA_TYPE, MediaType } from '@/types/media';
import { HTTP_METHOD } from '@/types/http';
import { SettingsService } from '@/settings/settings.service';

// Mapea nuestro MediaType interno al segmento de ruta que usa TMDB: el "show"
// interno corresponde a "tv" en la API de TMDB, no a "show" (eso daría 404).
const TMDB_ENDPOINT: Record<MediaType, string> = {
  [MEDIA_TYPE.MOVIE]: 'movie',
  [MEDIA_TYPE.SHOW]: 'tv',
};

// Size segment for every poster TMDB serves through this client. One constant
// so a search result (warm cache) and a details fallback (cold cache) can
// never end up pointing at different image sizes for the same film.
const TMDB_POSTER_SIZE = 'w300';

// Single place that turns a TMDB-relative poster_path into the absolute URL
// the rest of the app stores and renders. Exported so both the search path
// (`searchMovies`) and the details fallback (`fetchMovieFromTMDB`) in
// `movies.service.ts` build the exact same string for the same poster.
export function posterUrl(posterPath: string | null | undefined): string | null {
  return posterPath ? `https://image.tmdb.org/t/p/${TMDB_POSTER_SIZE}${posterPath}` : null;
}

// --- MAPPERS ---
// Estrategia de transformación para evitar if/else dentro de la función
const mappers = {
  [MEDIA_TYPE.MOVIE]: (data: TmdbMovieDetails): MovieDetail => ({
    type: MEDIA_TYPE.MOVIE,
    id: data.id,
    title: data.title,
    originalTitle: data.original_title,
    overview: data.overview,
    posterPath: data.poster_path,
    backdropPath: data.backdrop_path,
    originalLanguage: data.original_language,
    voteAverage: data.vote_average,
    releaseDate: data.release_date,
    runtime: data.runtime,
    status: data.status,
  }),
  [MEDIA_TYPE.SHOW]: (data: TmdbShowDetails): ShowDetail => ({
    type: MEDIA_TYPE.SHOW,
    id: data.id,
    title: data.name,
    originalTitle: data.original_name,
    overview: data.overview,
    posterPath: data.poster_path,
    backdropPath: data.backdrop_path,
    originalLanguage: data.original_language,
    voteAverage: data.vote_average,
    firstAirDate: data.first_air_date,
    numberOfSeasons: data.number_of_seasons,
    numberOfEpisodes: data.number_of_episodes,
    seasons: data.seasons?.map(s => ({
      id: s.id,
      name: s.name,
      seasonNumber: s.season_number,
      episodeCount: s.episode_count,
      releaseDate: s.air_date,
      overview: s.overview,
      posterPath: s.poster_path
    })) || [],
    status: data.status,
  }),
};

@Injectable()
export class TmdbClient implements MovieDBClient {
  constructor(private readonly settings: SettingsService) {}

  private async fetchResults<T>(endpoint: string, params: Record<string, string>): Promise<T[]> {
    const config = await this.settings.getMap();
    const urlPath = new URL(`${config.movie_db_api_version}/${endpoint}`, config.movie_db_host);
    for (const [key, value] of Object.entries(params)) {
      urlPath.searchParams.set(key, value);
    }

    const res = await fetch(urlPath.toString(), this.options(config.movie_db_api_key));

    if (!res.ok) {
      throw new Error(`TMDB request failed: ${res.status} ${res.statusText} (${urlPath.toString()})`);
    }

    const data = (await res.json()) as TmdbSearchResponse<T>;
    return data.results || [];
  }

  private async fetchPage<T>(endpoint: string, query: string, page: number = 1): Promise<T[]> {
    return this.fetchResults<T>(endpoint, { query, page: page.toString() });
  }

  private async fetchOne<T>(endpoint: string): Promise<T> {
    const config = await this.settings.getMap();
    const urlPath = new URL(`${config.movie_db_api_version}/${endpoint}`, config.movie_db_host);
    const res = await fetch(urlPath.toString(), this.options(config.movie_db_api_key));

    if (!res.ok) {
      throw new Error(`TMDB request failed: ${res.status} ${res.statusText} (${urlPath.toString()})`);
    }

    return (await res.json()) as T;
  }

  private options(apiKey: string) {
    return {
      method: HTTP_METHOD.GET,
      headers: {
        accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
    };
  }

  // 'thing' sería "movie", "tv", "person", "multi", etc.
  async search<T>(thing: string, query: string, page: number = 1): Promise<T[]> {
    return await this.fetchPage(`search/${thing}`, query, page) as T[];
  }

  // https://developer.themoviedb.org/reference/search-multi
  async searchMulti(query: string, page: number = 1) {
    const rows = await this.fetchPage<TmdbMultiSearchResult>('search/multi', query, page);
    return mapMultiSearchResults(rows);
  }

  // https://developer.themoviedb.org/reference/movie-popular-list
  // https://developer.themoviedb.org/reference/tv-series-popular-list
  async popular(type: MediaType, language: string): Promise<MediaSearchResult[]> {
    const endpoint = `${TMDB_ENDPOINT[type]}/popular`;

    if (type === MEDIA_TYPE.MOVIE) {
      const rows = await this.fetchResults<TmdbMovie>(endpoint, { language, page: '1' });
      return mapPopularMovies(rows);
    }

    const rows = await this.fetchResults<TmdbShow>(endpoint, { language, page: '1' });
    return mapPopularShows(rows);
  }

  async details(thing: MediaType, id: number): Promise<MediaDetail> {
    const endpoint = TMDB_ENDPOINT[thing];

    // Obtenemos los datos crudos
    const data = await this.fetchOne<TmdbMovieDetails | TmdbShowDetails>(`${endpoint}/${id}`);

    // Seleccionamos la estrategia de mapeo adecuada
    const transform = mappers[thing];

    if (!transform) {
      throw new Error(`Media type not supported: ${thing}`);
    }

    // Ejecutamos la transformación
    return transform(data as any);
  }

  async seasonDetails(id: number, seasonNumber: number): Promise<EpisodeDetail[]> {
    const data = await this.fetchOne<TmdbSeasonDetails>(`tv/${id}/season/${seasonNumber}`);

    return data.episodes.map((episode) => ({
      id: episode.id,
      title: episode.name,
      overview: episode.overview,
      releaseDate: episode.air_date,
      episodeNumber: episode.episode_number,
      stillPath: episode.still_path,
      voteAverage: episode.vote_average,
    }));
  }
}
