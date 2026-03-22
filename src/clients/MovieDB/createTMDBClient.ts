import { MovieDBClient, MediaDetail, ShowDetail, MovieDetail, EpisodeDetail } from "./types";
import { MEDIA_TYPE, MediaType } from "@/types/media";
import { HTTP_METHOD } from "@/types/http";

interface TmdbSearchResponse {
  page: number;
  results: TmdbResults[];
  total_pages: number;
  total_results: number;
}

interface TmdbBase {
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

interface TmdbMovie extends TmdbBase {
  original_title: string;
  release_date: string;       // Fecha de estreno
  title: string;
  video: boolean;
}

// Interfaces Específicas de Detalles (TMDB devuelve campos extra en endpoints de detalle)
interface TmdbMovieDetails extends TmdbMovie {
  runtime: number;
  status: string;
}

interface TmdbShow extends TmdbBase {
  origin_country: string[];   // Países de origen
  original_name: string;
  first_air_date: string;
  name: string;
}

interface TmdbSeason {
  air_date: string;
  episode_count: number;
  id: number;
  name: string;
  overview: string;
  poster_path: string;
  season_number: number;
  vote_average: number;
}

interface TmdbShowDetails extends TmdbShow {
  number_of_episodes: number;
  number_of_seasons: number;
  status: string;
  seasons: TmdbSeason[];
}

interface TmdbMulti extends TmdbBase {
  title: string;
  original_title: string;
  media_type: string;
  release_date: string;       // Fecha de estreno
  video: boolean;
}

type TmdbResults = TmdbMovie | TmdbShow | TmdbMulti;

interface TmdbEpisode {
  id: number;
  name: string;
  overview: string;
  air_date: string;
  episode_number: number;
  still_path: string | null;
  vote_average: number;
}

interface TmdbSeasonDetails {
  episodes: TmdbEpisode[];
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
  [MEDIA_TYPE.TV]: (data: TmdbShowDetails): ShowDetail => ({
    type: MEDIA_TYPE.TV,
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

export const createTMDBClient = (config : Record<string, string>): MovieDBClient => {
  
  const host = config.movie_db_host ?? "localhost";
  const apiVersion = "3";

  const api_key = config.movie_db_api_key;

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
        
    const res = await fetch(urlPath.toString(), options)

    const data = await res.json();
    return (data.results || []) as T[];
    
  }

  async function fetchOne<T>(endpoint: string): Promise<T> {
    const urlPath = new URL(`${apiVersion}/${endpoint}`, baseUrl);
    const res = await fetch(urlPath.toString(), options);
    return (await res.json()) as T;
  }

  return {
    // 'thing' sería "movie", "tv", "person", "multi", etc.
    async search<T>(thing: string, query: string, page: number = 1): Promise<T[]> {
      return await fetchPage(`search/${thing}`, query, page) as T[];
    },

    async details(thing: MediaType, id: number): Promise<MediaDetail> {
      // Obtenemos los datos crudos
      const data = await fetchOne<TmdbMovieDetails | TmdbShowDetails>(`${thing}/${id}`);
      
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