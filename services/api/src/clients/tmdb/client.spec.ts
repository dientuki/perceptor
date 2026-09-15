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
