// This suite exists because otherwise TMDB's own keywords response asymmetry
// (a film body nests keywords under `keywords`, a series body under
// `results`) fails silently: reading the wrong key returns `undefined`,
// which `classifyContentKind` then reads as "no keywords" and derives `CGI`
// — a real answer and a fallback becoming indistinguishable downstream, with
// no error anywhere.

import { TmdbClient } from './client';
import { SettingsService } from '@/settings/settings.service';
import { MEDIA_TYPE } from '@/types/media';

// Two disjoint id sets so a swapped key produces visibly wrong ids rather
// than an empty array in both directions.
const FILM_KEYWORD_IDS = [210024, 6513];
const SERIES_KEYWORD_IDS = [278823, 99999];

function settingsStub(): SettingsService {
  return {
    getMap: jest.fn().mockResolvedValue({
      movie_db_api_version: '3',
      movie_db_host: 'https://api.themoviedb.org/',
      movie_db_api_key: 'test-key',
    }),
  } as unknown as SettingsService;
}

function mockFetchOnce(body: unknown) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve(body),
  });
}

describe('TmdbClient.keywords', () => {
  let client: TmdbClient;

  beforeEach(() => {
    client = new TmdbClient(settingsStub());
    global.fetch = jest.fn();
  });

  it('reads a film body under the "keywords" key', async () => {
    mockFetchOnce({
      id: 1,
      keywords: FILM_KEYWORD_IDS.map((id) => ({ id, name: `keyword-${id}` })),
    });

    const ids = await client.keywords(MEDIA_TYPE.MOVIE, 1);

    expect(ids).toEqual(FILM_KEYWORD_IDS);
  });

  it('reads a series body under the "results" key, not "keywords"', async () => {
    mockFetchOnce({
      id: 2,
      results: SERIES_KEYWORD_IDS.map((id) => ({ id, name: `keyword-${id}` })),
    });

    const ids = await client.keywords(MEDIA_TYPE.SHOW, 2);

    expect(ids).toEqual(SERIES_KEYWORD_IDS);
  });

  it('returns [] for a body with neither key', async () => {
    mockFetchOnce({ id: 3 });

    const ids = await client.keywords(MEDIA_TYPE.MOVIE, 3);

    expect(ids).toEqual([]);
  });
});

describe('TmdbClient.details', () => {
  let client: TmdbClient;

  beforeEach(() => {
    client = new TmdbClient(settingsStub());
    global.fetch = jest.fn();
  });

  // A detail response never carries `genre_ids` (that's search/discover-only)
  // — it carries `genres: {id, name}[]`. Reading the wrong field silently
  // yields `undefined`/`[]`, which classifyContentKind then reads as
  // "not animated" for every title that has to fall back to details() for
  // its content-kind top-up, never actually classifying ANIME/CGI.
  it('derives genreIds from the "genres" array, not a "genre_ids" field', async () => {
    mockFetchOnce({
      id: 1185806,
      title: 'PAW Patrol: The Dino Movie',
      genres: [{ id: 16, name: 'Animation' }, { id: 12, name: 'Adventure' }],
      runtime: 90,
      status: 'Released',
    });

    const detail = await client.details(MEDIA_TYPE.MOVIE, 1185806);

    expect(detail.genreIds).toEqual([16, 12]);
  });

  it('returns [] when a detail response has no genres at all', async () => {
    mockFetchOnce({ id: 1, title: 'x', runtime: 10, status: 'Released' });

    const detail = await client.details(MEDIA_TYPE.MOVIE, 1);

    expect(detail.genreIds).toEqual([]);
  });
});
