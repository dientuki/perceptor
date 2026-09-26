// This suite exists because otherwise TMDB's own keywords response asymmetry
// (a film body nests keywords under `keywords`, a series body under
// `results`) fails silently: reading the wrong key returns `undefined`,
// which `classifyContentKind` then reads as "no keywords" and derives `CGI`
// — a real answer and a fallback becoming indistinguishable downstream, with
// no error anywhere.

import { TmdbClient } from './client';
import { TmdbHttpError } from './errors';
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

// This suite exists because otherwise a registration stores the wrong
// release date with no error anywhere: picking the first entry instead of the
// earliest, or comparing raw timestamps of mixed shape, still yields a valid
// date, and an empty response yielding "" would overwrite the plain date.
// `.earliest` feeds 062's calendar, so a regression there silently moves every
// film. The per-type fields exist so a wrong type mapping (2 and 3 both
// theatrical, unknown types counting toward earliest only) yields a valid but
// wrong window with no error.
describe('TmdbClient.movieReleaseDates', () => {
  let client: TmdbClient;

  beforeEach(() => {
    client = new TmdbClient(settingsStub());
    global.fetch = jest.fn();
  });

  const entry = (day: string, type?: number) => ({
    release_date: `${day}T00:00:00.000Z`,
    ...(type === undefined ? {} : { type }),
  });

  it('picks the earliest date across countries and release types', async () => {
    mockFetchOnce({
      results: [
        { iso_3166_1: 'MX', release_dates: [{ release_date: '2026-02-19T00:00:00.000Z' }] },
        {
          iso_3166_1: 'EE',
          release_dates: [
            { release_date: '2026-01-10T00:00:00.000Z' },
            { release_date: '2025-11-15T00:00:00.000Z' },
          ],
        },
      ],
    });

    expect((await client.movieReleaseDates(1)).earliest).toBe('2025-11-15');
  });

  it('returns null earliest when there are no usable dates', async () => {
    mockFetchOnce({
      results: [{ iso_3166_1: 'US', release_dates: [{ release_date: '' }] }],
    });

    expect((await client.movieReleaseDates(1)).earliest).toBeNull();
  });

  it('returns all fields null for an empty response', async () => {
    mockFetchOnce({});

    expect(await client.movieReleaseDates(1)).toEqual({
      earliest: null,
      theatrical: null,
      digital: null,
      physical: null,
    });
  });

  it('counts both type 2 and type 3 as theatrical', async () => {
    mockFetchOnce({
      results: [{ iso_3166_1: 'US', release_dates: [entry('2026-03-01', 3), entry('2026-02-01', 2)] }],
    });
    expect((await client.movieReleaseDates(1)).theatrical).toBe('2026-02-01');

    mockFetchOnce({
      results: [{ iso_3166_1: 'US', release_dates: [entry('2026-03-01', 3)] }],
    });
    expect((await client.movieReleaseDates(1)).theatrical).toBe('2026-03-01');
  });

  it('takes the earliest date across countries independently per type', async () => {
    mockFetchOnce({
      results: [
        { iso_3166_1: 'US', release_dates: [entry('2026-03-10', 3), entry('2026-05-20', 4), entry('2026-06-20', 5)] },
        { iso_3166_1: 'JP', release_dates: [entry('2026-04-01', 3), entry('2026-05-01', 4), entry('2026-07-01', 5)] },
      ],
    });

    expect(await client.movieReleaseDates(1)).toEqual({
      earliest: '2026-03-10',
      theatrical: '2026-03-10',
      digital: '2026-05-01',
      physical: '2026-06-20',
    });
  });

  it('leaves a type with no entry anywhere null', async () => {
    mockFetchOnce({
      results: [{ iso_3166_1: 'US', release_dates: [entry('2026-03-10', 3)] }],
    });

    const dates = await client.movieReleaseDates(1);

    expect(dates.digital).toBeNull();
    expect(dates.physical).toBeNull();
  });

  it('counts premiere, TV, unknown and missing types toward earliest only', async () => {
    mockFetchOnce({
      results: [
        {
          iso_3166_1: 'US',
          release_dates: [entry('2026-01-01', 1), entry('2026-01-02', 6), entry('2026-01-03', 99), entry('2026-01-04')],
        },
      ],
    });

    expect(await client.movieReleaseDates(1)).toEqual({
      earliest: '2026-01-01',
      theatrical: null,
      digital: null,
      physical: null,
    });
  });
});

// This block exists because otherwise a rejected TMDB credential (401) and an
// outage are indistinguishable to callers: both were a bare Error, so anything
// deciding "key is wrong" versus "TMDB is down" had to parse message text.
describe('TmdbClient non-ok responses', () => {
  let client: TmdbClient;

  beforeEach(() => {
    client = new TmdbClient(settingsStub());
    global.fetch = jest.fn();
  });

  function mockStatus(status: number, statusText: string) {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status, statusText });
  }

  it('throws TmdbHttpError carrying the status from fetchOne', async () => {
    mockStatus(401, 'Unauthorized');

    const err = await client.details(MEDIA_TYPE.MOVIE, 1).catch((e) => e);

    expect(err).toBeInstanceOf(TmdbHttpError);
    expect(err.status).toBe(401);
    expect(err.message).toMatch(/^TMDB request failed: 401 Unauthorized \(/);
  });

  it('throws TmdbHttpError carrying the status from fetchResults', async () => {
    mockStatus(503, 'Service Unavailable');

    const err = await client.searchMulti('x').catch((e) => e);

    expect(err).toBeInstanceOf(TmdbHttpError);
    expect(err.status).toBe(503);
  });
});
