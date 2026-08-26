import { MediaSearchResult } from '@/clients/types';
import { MEDIA_TYPE } from '@/types/media';
import { TmdbMultiSearchResult } from './types';
import { posterUrl } from './client';

// https://developer.themoviedb.org/reference/search-multi
export function mapMultiSearchResults(rows: TmdbMultiSearchResult[]): MediaSearchResult[] {
  const results: MediaSearchResult[] = [];

  for (const row of rows) {
    if (row.media_type === 'movie' && row.title) {
      results.push({
        id: row.id,
        title: row.title,
        releaseDate: row.release_date || null,
        posterUrl: posterUrl(row.poster_path),
        originalLanguage: row.original_language,
        overview: row.overview,
        type: MEDIA_TYPE.MOVIE,
      });
      continue;
    }

    if (row.media_type === 'tv' && row.name) {
      results.push({
        id: row.id,
        title: row.name,
        releaseDate: row.first_air_date || null,
        posterUrl: posterUrl(row.poster_path),
        originalLanguage: row.original_language,
        overview: row.overview,
        type: MEDIA_TYPE.SHOW,
      });
      continue;
    }
  }

  return results;
}
