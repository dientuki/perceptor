import {
  TmdbSearchResponse,
  TmdbMovieDetails,
  TmdbShowDetails,
  TmdbSeasonDetails,
} from './types';
import { MovieDBClient, MediaDetail, ShowDetail, MovieDetail, EpisodeDetail } from '@/clients/types';
import { MEDIA_TYPE, MediaType } from '@/types/media';
import { HTTP_METHOD } from '@/types/http';

// Mapea nuestro MediaType interno al segmento de ruta que usa TMDB: el "show"
// interno corresponde a "tv" en la API de TMDB, no a "show" (eso daría 404).
const TMDB_ENDPOINT: Record<MediaType, string> = {
  [MEDIA_TYPE.MOVIE]: 'movie',
  [MEDIA_TYPE.SHOW]: 'tv',
};

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

export const createTMDBClient = (): MovieDBClient => {

  const host = "https://api.themoviedb.org";
  const apiVersion = "3";

  // TODO: leer de la tabla Setting (movie_db_api_key) cuando exista
  const api_key = "eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI0YTVlNTExZTk3YmI0OTkwYmFiNGVkYmM2OTMyYTk1MSIsIm5iZiI6MTc3MDc2NjgyNy45MTY5OTk4LCJzdWIiOiI2OThiYzFlYjM3NDA4OGIyZDE4ODVjNGQiLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.nIJZYCjsP--p54gQmYV1WUuHOhpn9qey5byeI_QZUS4";

  const baseUrl = host;

  const options = {
    method: HTTP_METHOD.GET,
    headers: {
      accept: 'application/json',
      Authorization: `Bearer ${api_key}`
    }
  };

  async function fetchPage<T>(endpoint: string, query: string, page: number = 1): Promise<T[]> {
    const urlPath = new URL(`${apiVersion}/${endpoint}`, baseUrl);
    urlPath.searchParams.set("query", query);
    urlPath.searchParams.set("page", page.toString());

    const res = await fetch(urlPath.toString(), options);

    if (!res.ok) {
      throw new Error(`TMDB request failed: ${res.status} ${res.statusText} (${urlPath.toString()})`);
    }

    const data = (await res.json()) as TmdbSearchResponse<T>;
    return data.results || [];
  }

  async function fetchOne<T>(endpoint: string): Promise<T> {
    const urlPath = new URL(`${apiVersion}/${endpoint}`, baseUrl);
    const res = await fetch(urlPath.toString(), options);

    if (!res.ok) {
      throw new Error(`TMDB request failed: ${res.status} ${res.statusText} (${urlPath.toString()})`);
    }

    return (await res.json()) as T;
  }

  return {
    // 'thing' sería "movie", "tv", "person", "multi", etc.
    async search<T>(thing: string, query: string, page: number = 1): Promise<T[]> {
      return await fetchPage(`search/${thing}`, query, page) as T[];
    },

    async details(thing: MediaType, id: number): Promise<MediaDetail> {
      const endpoint = TMDB_ENDPOINT[thing];

      // Obtenemos los datos crudos
      const data = await fetchOne<TmdbMovieDetails | TmdbShowDetails>(`${endpoint}/${id}`);

      // Seleccionamos la estrategia de mapeo adecuada
      const transform = mappers[thing];

      if (!transform) {
        throw new Error(`Media type not supported: ${thing}`);
      }

      // Ejecutamos la transformación
      return transform(data as any);
    },

    async seasonDetails(id: number, seasonNumber: number): Promise<EpisodeDetail[]> {
      const data = await fetchOne<TmdbSeasonDetails>(`tv/${id}/season/${seasonNumber}`);

      return data.episodes.map((episode) => ({
        id: episode.id,
        title: episode.name,
        overview: episode.overview,
        releaseDate: episode.air_date,
        episodeNumber: episode.episode_number,
        stillPath: episode.still_path,
        voteAverage: episode.vote_average,
      }));
    },
  };
}
