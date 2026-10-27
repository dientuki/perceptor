// These mappers translate Plex's hand-typed JSON shapes with no schema check
// on either side. A wrong field name (Guid, guid, parentIndex, Media/Part/file,
// Location.path) does not throw: a dropped GUID leaves a title MISSING forever
// (also the correct output for an empty library), a missing present-episode
// filter marks a series with no files COMPLETED, and a wrong section choice
// scans a folder that does not contain the new file while the encode reports
// success. Only cases like these, each verified to fail when its rule is
// removed, catch it.

import {
  toLibraryEntries,
  toPresentEpisodes,
  chooseSectionForPath,
  createPlexClient,
  pickEpisodeFile,
  PlexItem,
  PlexEpisode,
  PlexSection,
} from './plex';
import { MEDIA_TYPE } from '@/types/media';

describe('toLibraryEntries', () => {
  it('reads a modern tmdb:// GUID and keeps ratingKey as externalId', () => {
    const items: PlexItem[] = [
      {
        ratingKey: '4521',
        guid: 'plex://movie/5d776b59ad5437001f79c6f8',
        Guid: [{ id: 'imdb://tt0437086' }, { id: 'tmdb://299534' }],
      },
    ];
    expect(toLibraryEntries(items, MEDIA_TYPE.MOVIE)).toEqual([
      { mediaType: MEDIA_TYPE.MOVIE, tmdbId: 299534, externalId: '4521' },
    ]);
  });

  it('reads a legacy agent GUID', () => {
    const items: PlexItem[] = [
      {
        ratingKey: '77',
        guid: 'com.plexapp.agents.themoviedb://1405?lang=en',
      },
    ];
    expect(toLibraryEntries(items, MEDIA_TYPE.SHOW)).toEqual([
      { mediaType: MEDIA_TYPE.SHOW, tmdbId: 1405, externalId: '77' },
    ]);
  });

  it('drops an item carrying neither GUID shape', () => {
    const items: PlexItem[] = [
      {
        ratingKey: '9',
        guid: 'plex://movie/abc',
        Guid: [{ id: 'imdb://tt0437086' }, { id: 'tvdb://81189' }],
      },
    ];
    expect(toLibraryEntries(items, MEDIA_TYPE.MOVIE)).toEqual([]);
  });

  it('drops an item whose tmdb id is non-numeric or zero', () => {
    const items: PlexItem[] = [
      { ratingKey: '1', Guid: [{ id: 'tmdb://abc' }] },
      { ratingKey: '2', Guid: [{ id: 'tmdb://0' }] },
    ];
    expect(toLibraryEntries(items, MEDIA_TYPE.MOVIE)).toEqual([]);
  });
});

describe('toPresentEpisodes', () => {
  const wellFormed: PlexEpisode = {
    parentIndex: 1,
    index: 2,
    Media: [{ Part: [{ file: '/tv/Show/Season 01/S01E02.mkv' }] }],
  };

  it('keeps an episode with a file and both numbers', () => {
    expect(toPresentEpisodes([wellFormed])).toEqual([
      { seasonNumber: 1, episodeNumber: 2 },
    ]);
  });

  it('drops an episode with no Media', () => {
    expect(toPresentEpisodes([{ ...wellFormed, Media: undefined }])).toEqual(
      [],
    );
  });

  it('drops an episode whose Part has no file', () => {
    expect(
      toPresentEpisodes([{ ...wellFormed, Media: [{ Part: [{}] }] }]),
    ).toEqual([]);
  });

  it('drops an episode missing parentIndex or index', () => {
    expect(
      toPresentEpisodes([
        { ...wellFormed, parentIndex: undefined },
        { ...wellFormed, index: null },
      ]),
    ).toEqual([]);
  });

  it('keeps season 0 and episode 0', () => {
    expect(toPresentEpisodes([{ ...wellFormed, parentIndex: 0 }])).toEqual([
      { seasonNumber: 0, episodeNumber: 2 },
    ]);
  });
});

describe('chooseSectionForPath', () => {
  const movies: PlexSection = {
    key: '1',
    type: 'movie',
    Location: [{ path: '/media/movies' }],
  };
  const movies4k: PlexSection = {
    key: '2',
    type: 'movie',
    Location: [{ path: '/media/movies-4k' }],
  };
  const nested: PlexSection = {
    key: '3',
    type: 'movie',
    Location: [{ path: '/media/movies/anime' }],
  };

  it('chooses the section whose location contains the path', () => {
    expect(
      chooseSectionForPath([movies], '/media/movies/A (2019)/A (2019).mkv'),
    ).toBe(movies);
  });

  it('prefers the longest matching location', () => {
    expect(
      chooseSectionForPath(
        [movies, nested],
        '/media/movies/anime/B (2020)/B (2020).mkv',
      ),
    ).toBe(nested);
  });

  it('refuses a sibling that merely shares a prefix', () => {
    expect(
      chooseSectionForPath([movies], '/media/movies-4k/C (2021)/C.mkv'),
    ).toBeNull();
    expect(
      chooseSectionForPath([movies, movies4k], '/media/movies-4k/C/C.mkv'),
    ).toBe(movies4k);
  });

  it('returns null when no section matches', () => {
    expect(chooseSectionForPath([movies], '/elsewhere/D.mkv')).toBeNull();
  });
});

describe('createPlexClient requests', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('sends the token as a header and never in the URL', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    global.fetch = jest.fn((url: URL, init: RequestInit) => {
      calls.push({
        url: String(url),
        headers: init.headers as Record<string, string>,
      });
      return Promise.resolve(
        new Response(JSON.stringify({ MediaContainer: { Directory: [] } })),
      );
    }) as unknown as typeof fetch;

    const client = createPlexClient(
      { host: 'plex', port: '32400', apiKey: 'secret-token' },
      { lookup: jest.fn() },
    );
    await client.createdMedia('/nowhere/x.mkv');

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.url).not.toContain('secret-token');
      expect(call.url).not.toContain('X-Plex-Token');
      expect(call.headers['X-Plex-Token']).toBe('secret-token');
      expect(call.headers.Accept).toBe('application/json');
    }
    expect(calls.map((c) => c.url)).toContain(
      'http://plex:32400/library/sections/all/refresh',
    );
  });
});

// Spec 107, REQ-4: the press-time path comes from Plex's allLeaves listing,
// where an episode is only identifiable by parentIndex/index. Matching the
// wrong episode embeds subtitles into another episode's file with no error.
describe('pickEpisodeFile', () => {
  const leaf = (parentIndex: number, index: number, file: string | null) => ({
    parentIndex,
    index,
    Media: file ? [{ Part: [{ file }] }] : [],
  });

  it('picks the episode by parentIndex and index', () => {
    const items = [
      leaf(1, 1, '/tv/S01E01.mkv'),
      leaf(1, 2, '/tv/S01E02.mkv'),
      leaf(2, 1, '/tv/S02E01.mkv'),
    ];

    expect(pickEpisodeFile(items, 2, 1)).toBe('/tv/S02E01.mkv');
    expect(pickEpisodeFile(items, 1, 2)).toBe('/tv/S01E02.mkv');
  });

  it('answers null when the episode is absent or has no file', () => {
    expect(pickEpisodeFile([leaf(1, 1, '/tv/a.mkv')], 1, 2)).toBeNull();
    expect(pickEpisodeFile([leaf(1, 1, null)], 1, 1)).toBeNull();
  });
});

describe('createPlexClient mediaHostPath and modifiedMedia', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });
  const client = () =>
    createPlexClient(
      { host: 'plex', port: '32400', apiKey: 't' },
      { lookup: jest.fn() },
    );
  const answer = (routes: Record<string, unknown>, calls: string[] = []) => {
    global.fetch = jest.fn((url: URL) => {
      calls.push(String(url));
      const body = routes[url.pathname];
      return Promise.resolve(new Response(JSON.stringify(body ?? {})));
    }) as unknown as typeof fetch;
  };

  it('reads a film file from its own metadata', async () => {
    answer({
      '/library/metadata/9': {
        MediaContainer: {
          Metadata: [{ Media: [{ Part: [{ file: '/m/Film.mkv' }] }] }],
        },
      },
    });
    await expect(client().mediaHostPath!('9')).resolves.toBe('/m/Film.mkv');
  });

  it('reads an episode file from allLeaves by season and episode', async () => {
    answer({
      '/library/metadata/5/allLeaves': {
        MediaContainer: {
          Metadata: [
            { parentIndex: 1, index: 1, Media: [{ Part: [{ file: '/a.mkv' }] }] },
            { parentIndex: 1, index: 2, Media: [{ Part: [{ file: '/b.mkv' }] }] },
          ],
        },
      },
    });
    await expect(client().mediaHostPath!('5', 1, 2)).resolves.toBe('/b.mkv');
    await expect(client().mediaHostPath!('5', 3, 1)).resolves.toBeNull();
  });

  it('modifiedMedia runs the section-scoped scan of the file directory', async () => {
    const calls: string[] = [];
    answer(
      {
        '/library/sections': {
          MediaContainer: {
            Directory: [
              { key: '2', type: 'movie', Location: [{ path: '/m' }] },
            ],
          },
        },
      },
      calls,
    );
    await client().modifiedMedia!('/m/Film.mkv');
    expect(calls).toContain(
      'http://plex:32400/library/sections/2/refresh?path=%2Fm',
    );
  });
});
