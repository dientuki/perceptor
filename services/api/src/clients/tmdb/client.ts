import { Injectable } from '@nestjs/common';
import {
  TmdbSearchResponse,
  TmdbMovie,
  TmdbMovieDetails,
  TmdbShow,
  TmdbShowDetails,
  TmdbSeasonDetails,
  TmdbMultiSearchResult,
  TmdbMovieKeywords,
  TmdbShowKeywords,
} from './types';
import { mapMultiSearchResults } from './multi';
import { mapPopularMovies, mapPopularShows } from './popular';
import { MovieDBClient, MovieReleaseDates, MediaDetail, MediaSearchResult, ShowDetail, MovieDetail, EpisodeDetail } from '@/clients/types';
import { TmdbHttpError } from './errors';
import { MEDIA_TYPE, MediaType } from '@/types/media';
import { HTTP_METHOD } from '@/types/http';
import { SettingsService } from '@/settings/settings.service';

const TMDB_ENDPOINT: Record<MediaType, string> = {
  [MEDIA_TYPE.MOVIE]: 'movie',
  [MEDIA_TYPE.SHOW]: 'tv',
};

// https://developer.themoviedb.org/reference/movie-release-dates
const RELEASE_TYPE_FIELD: Record<number, 'theatrical' | 'digital' | 'physical'> = {
  2: 'theatrical',
  3: 'theatrical',
  4: 'digital',
  5: 'physical',
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
    genreIds: data.genres?.map((g) => g.id) ?? [],
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
    genreIds: data.genres?.map((g) => g.id) ?? [],
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
      throw new TmdbHttpError(res.status, `TMDB request failed: ${res.status} ${res.statusText} (${urlPath.toString()})`);
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
      throw new TmdbHttpError(res.status, `TMDB request failed: ${res.status} ${res.statusText} (${urlPath.toString()})`);
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

    const data = await this.fetchOne<TmdbMovieDetails | TmdbShowDetails>(`${endpoint}/${id}`);

    const transform = mappers[thing];

    if (!transform) {
      throw new Error(`Media type not supported: ${thing}`);
    }

    return transform(data as any);
  }

  // https://developer.themoviedb.org/reference/movie-keywords
  // https://developer.themoviedb.org/reference/tv-series-keywords
  // TMDB nests the list under a different key per media type — a film body
  // carries `keywords`, a series body carries `results`. Absorbed here so
  // every caller gets a flat id list, or [] for a body with neither key.
  async keywords(thing: MediaType, id: number): Promise<number[]> {
    const endpoint = TMDB_ENDPOINT[thing];

    if (thing === MEDIA_TYPE.MOVIE) {
      const data = await this.fetchOne<TmdbMovieKeywords>(`${endpoint}/${id}/keywords`);
      return (data.keywords ?? []).map((keyword) => keyword.id);
    }

    const data = await this.fetchOne<TmdbShowKeywords>(`${endpoint}/${id}/keywords`);
    return (data.results ?? []).map((keyword) => keyword.id);
  }

  async movieReleaseDates(id: number): Promise<MovieReleaseDates> {
    const data = await this.fetchOne<{
      results?: { release_dates?: { release_date?: string; type?: number }[] }[];
    }>(`movie/${id}/release_dates`);

    const dates: MovieReleaseDates = { earliest: null, theatrical: null, digital: null, physical: null };
    const keepEarlier = (field: keyof MovieReleaseDates, day: string) => {
      const current = dates[field];
      if (current === null || day < current) dates[field] = day;
    };

    for (const country of data.results ?? []) {
      for (const entry of country.release_dates ?? []) {
        const day = (entry.release_date ?? '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
        keepEarlier('earliest', day);
        const field = entry.type === undefined ? undefined : RELEASE_TYPE_FIELD[entry.type];
        if (field) keepEarlier(field, day);
      }
    }
    return dates;
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
