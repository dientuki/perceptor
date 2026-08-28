import { MediaSearchResult } from '@/clients/types';
import { MEDIA_TYPE } from '@/types/media';
import { TmdbMovie, TmdbShow } from './types';
import { posterUrl } from './client';

// https://developer.themoviedb.org/reference/movie-popular-list
export function mapPopularMovies(rows: TmdbMovie[]): MediaSearchResult[] {
  return rows.map(item => ({
    id: item.id,
    title: item.title,
    releaseDate: item.release_date || null,
    posterUrl: posterUrl(item.poster_path),
    originalLanguage: item.original_language,
    overview: item.overview,
    type: MEDIA_TYPE.MOVIE,
  }));
}

// https://developer.themoviedb.org/reference/tv-series-popular-list
export function mapPopularShows(rows: TmdbShow[]): MediaSearchResult[] {
  return rows.map(item => ({
    id: item.id,
    title: item.name,
    releaseDate: item.first_air_date || null,
    posterUrl: posterUrl(item.poster_path),
    originalLanguage: item.original_language,
    overview: item.overview,
    type: MEDIA_TYPE.SHOW,
  }));
}
