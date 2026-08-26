// This suite exists because otherwise the mixed-row mapping fails quietly:
// a `media_type` check written against `"show"` instead of `"tv"` drops
// every series from every mixed search, a `tv` row mapped through the film
// mapper produces a card with an empty title and no year, and a `person` (or
// any other future) row that slips through reaches the user as an
// unregistrable card. None of these surface as an error anywhere — the
// response is a successful, shorter (or wrongly-typed) list.

import { mapMultiSearchResults } from './multi';
import { TmdbMultiSearchResult } from './types';
import { MEDIA_TYPE } from '@/types/media';

function movieRow(overrides: Partial<TmdbMultiSearchResult> = {}): TmdbMultiSearchResult {
  return {
    media_type: 'movie',
    id: 1,
    title: 'Spider-Man',
    release_date: '2002-05-03',
    poster_path: '/spiderman.jpg',
    original_language: 'en',
    overview: 'A hero is born.',
    ...overrides,
  };
}

function showRow(overrides: Partial<TmdbMultiSearchResult> = {}): TmdbMultiSearchResult {
  return {
    media_type: 'tv',
    id: 2,
    name: 'Spider-Man: The Animated Series',
    first_air_date: '1994-11-19',
    poster_path: '/spiderman-tas.jpg',
    original_language: 'en',
    overview: 'The animated version.',
    ...overrides,
  };
}

describe('mapMultiSearchResults', () => {
  it('maps a film row with title/release_date and the w300 poster URL', () => {
    const [result] = mapMultiSearchResults([movieRow()]);

    expect(result).toMatchObject({
      id: 1,
      title: 'Spider-Man',
      releaseDate: '2002-05-03',
      type: MEDIA_TYPE.MOVIE,
      posterUrl: 'https://image.tmdb.org/t/p/w300/spiderman.jpg',
    });
  });

  it('maps a series row with name/first_air_date and type === "show", not "tv"', () => {
    const [result] = mapMultiSearchResults([showRow()]);

    expect(result.type).toBe('show');
    expect(result).toMatchObject({
      id: 2,
      title: 'Spider-Man: The Animated Series',
      releaseDate: '1994-11-19',
    });
  });

  it('drops a person row', () => {
    const results = mapMultiSearchResults([
      { media_type: 'person', id: 3, poster_path: null, original_language: 'en', overview: '' },
    ]);

    expect(results).toEqual([]);
  });

  it('drops a row with an unknown future media_type', () => {
    const results = mapMultiSearchResults([
      {
        media_type: 'collection',
        id: 4,
        title: 'The Spider-Man Collection',
        poster_path: null,
        original_language: 'en',
        overview: '',
      },
    ]);

    expect(results).toEqual([]);
  });

  it('drops a movie row with no title', () => {
    const results = mapMultiSearchResults([movieRow({ title: undefined })]);

    expect(results).toEqual([]);
  });

  it('drops a tv row with no name', () => {
    const results = mapMultiSearchResults([showRow({ name: undefined })]);

    expect(results).toEqual([]);
  });

  it('preserves catalog order across survivors, dropping non-survivors in place', () => {
    const results = mapMultiSearchResults([
      movieRow({ id: 1, title: 'Film One' }),
      { media_type: 'person', id: 99, poster_path: null, original_language: 'en', overview: '' },
      showRow({ id: 2, name: 'Show One' }),
      movieRow({ id: 3, title: 'Film Two' }),
    ]);

    expect(results.map(r => r.id)).toEqual([1, 2, 3]);
  });

  it('yields posterUrl === null for a null poster_path, not a broken URL', () => {
    const [result] = mapMultiSearchResults([movieRow({ poster_path: null })]);

    expect(result.posterUrl).toBeNull();
  });
});
