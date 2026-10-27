import { SubtitleSearchRequestService } from './subtitle-search-request.service';
import { Prisma } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { ERROR_KEYS } from '@/i18n/error-keys';

type SearchRow = {
  id: number;
  movieId?: number;
  episodeId?: number;
  status: string;
  errorKey: string | null;
  wantedLanguages: string[];
  libraryPath?: string;
};

type Fixture = {
  available: boolean;
  userMovies: Array<{ userId: string; preference: boolean }>;
  userShows: Array<{ userId: string; preference: boolean }>;
  titleLanguages: Record<string, string[]>;
  userLanguages: Record<string, string[]>;
};

// This suite exists because a search that starts when it should not is silent in both directions:
// a row created with the user's preference off spends the shared OpenSubtitles quota and rewrites a
// library file nobody asked to touch; a row missing for an opted-in title leaves it without
// subtitles and no error anywhere; an earlier search left running beside a newer one embeds a
// stale candidate over the replacement file; and a throw out of this service would fail the
// delivery report of an encode that already finished. It runs the real selection rules over a
// stateful fake of the tables (Article IX, Spec 103, REQ-3 REQ-4 REQ-5 REQ-12).
describe('SubtitleSearchRequestService', () => {
  let searches: SearchRow[];
  let wake: jest.Mock;
  let preflight: jest.Mock;
  let mediaServer: { createClient: jest.Mock };
  let usable: jest.Mock;
  let mediaRoots: { hostToContainerPath: jest.Mock };
  let transaction: jest.Mock;
  let fixture: Fixture;
  let service: SubtitleSearchRequestService;
  let nextId: number;

  const language = (iso3: string) => ({ language: { iso3 } });

  beforeEach(() => {
    searches = [];
    nextId = 1;
    wake = jest.fn().mockResolvedValue(undefined);
    preflight = jest.fn().mockResolvedValue({ filePath: '/lib/a.mkv' });
    fixture = {
      available: true,
      userMovies: [{ userId: 'u1', preference: true }],
      userShows: [],
      titleLanguages: {},
      userLanguages: { u1: ['spa'] },
    };

    const create = jest.fn(
      ({ data }: { data: Omit<SearchRow, 'id' | 'errorKey'> }) => {
        const row = { ...data, id: nextId++, errorKey: null };
        searches.push(row);
        return Promise.resolve(row);
      },
    );
    const updateMany = jest.fn(
      ({
        where,
        data,
      }: {
        where: {
          movieId?: number;
          episodeId?: number;
          status: { in: string[] };
        };
        data: Partial<SearchRow>;
      }) => {
        let count = 0;
        for (const row of searches) {
          const sameTarget =
            (where.movieId !== undefined && row.movieId === where.movieId) ||
            (where.episodeId !== undefined &&
              row.episodeId === where.episodeId);
          if (sameTarget && where.status.in.includes(row.status)) {
            Object.assign(row, data);
            count += 1;
          }
        }
        return Promise.resolve({ count });
      },
    );

    const count = jest.fn(
      ({
        where,
      }: {
        where: {
          movieId?: number;
          episodeId?: number;
          status: { in: string[] };
        };
      }) =>
        Promise.resolve(
          searches.filter(
            (row) =>
              ((where.movieId !== undefined && row.movieId === where.movieId) ||
                (where.episodeId !== undefined &&
                  row.episodeId === where.episodeId)) &&
              where.status.in.includes(row.status),
          ).length,
        ),
    );
    transaction = jest.fn((fn: (tx: unknown) => Promise<unknown>) =>
      fn({ subtitleSearch: { create, updateMany, count } }),
    );

    const prisma = {
      userMovie: {
        findMany: jest.fn(
          ({ where }: { where: Record<string, unknown> & { user: { subtitleSearch: boolean } } }) => {
            expect(where).not.toHaveProperty('subtitleSearch');
            return Promise.resolve(
              fixture.userMovies
                .filter((row) => row.preference === where.user.subtitleSearch)
                .map((row) => ({ userId: row.userId })),
            );
          },
        ),
      },
      userShow: {
        findMany: jest.fn(
          ({ where }: { where: Record<string, unknown> & { user: { subtitleSearch: boolean } } }) => {
            expect(where).not.toHaveProperty('subtitleSearch');
            return Promise.resolve(
              fixture.userShows
                .filter((row) => row.preference === where.user.subtitleSearch)
                .map((row) => ({ userId: row.userId })),
            );
          },
        ),
      },
      episode: {
        findUnique: jest.fn().mockResolvedValue({ season: { showId: 3 } }),
      },
      userMovieLanguage: {
        findMany: jest.fn(({ where }: { where: { userId: string } }) =>
          Promise.resolve(
            (fixture.titleLanguages[where.userId] ?? []).map(language),
          ),
        ),
      },
      userShowLanguage: {
        findMany: jest.fn(({ where }: { where: { userId: string } }) =>
          Promise.resolve(
            (fixture.titleLanguages[where.userId] ?? []).map(language),
          ),
        ),
      },
      userLanguagePreference: {
        findMany: jest.fn(({ where }: { where: { userId: string } }) =>
          Promise.resolve(
            (fixture.userLanguages[where.userId] ?? []).map(language),
          ),
        ),
      },
      subtitleSearch: { create, updateMany },
      $transaction: transaction,
    };
    const capabilities = {
      isSubtitleSearchAvailable: jest.fn(() =>
        Promise.resolve(fixture.available),
      ),
    };

    mediaServer = { createClient: jest.fn().mockResolvedValue(null) };
    usable = jest.fn().mockResolvedValue(undefined);
    mediaRoots = {
      hostToContainerPath: jest.fn((_root: string, p: string) =>
        p.startsWith('/host/lib/') ? p.replace('/host/lib', '/lib') : null,
      ),
    };

    service = new SubtitleSearchRequestService(
      prisma as never,
      capabilities as never,
      { wake } as never,
      {
        assertManualSearchPreflight: preflight,
        assertUsableMkv: usable,
      } as never,
      mediaServer as never,
      mediaRoots as never,
    );
  });

  it('inserts a WAITING search with the wanted languages and wakes it', async () => {
    await service.requestFor({ kind: 'movie', id: 10 });

    expect(searches).toEqual([
      expect.objectContaining({
        movieId: 10,
        status: 'WAITING',
        wantedLanguages: ['spa'],
      }),
    ]);
    expect(wake).toHaveBeenCalledWith(1, 0);
  });

  it('writes no row when the media server is not Jellyfin', async () => {
    fixture.available = false;

    await service.requestFor({ kind: 'movie', id: 10 });

    expect(searches).toHaveLength(0);
    expect(wake).not.toHaveBeenCalled();
  });

  it('opts an owner in by the user preference alone, with no per-title state', async () => {
    fixture.userMovies = [{ userId: 'u1', preference: true }];

    await service.requestFor({ kind: 'movie', id: 10 });

    expect(searches).toHaveLength(1);
  });

  it('writes no row when the owner preference is off', async () => {
    fixture.userMovies = [{ userId: 'u1', preference: false }];

    await service.requestFor({ kind: 'movie', id: 10 });

    expect(searches).toHaveLength(0);
  });

  it('starts one search for a mixed series whose languages come only from the opted-in owner', async () => {
    fixture.userShows = [
      { userId: 'u1', preference: true },
      { userId: 'u2', preference: false },
    ];
    fixture.titleLanguages = { u1: ['fra'], u2: ['deu'] };
    fixture.userLanguages = { u1: ['spa'], u2: ['ita'] };

    await service.requestFor({ kind: 'episode', id: 5 });

    expect(searches).toHaveLength(1);
    expect(searches[0].wantedLanguages).toEqual(['fra']);
  });

  it('uses the per-title list when it is not empty and the user list otherwise', async () => {
    fixture.titleLanguages = { u1: ['fra'] };
    await service.requestFor({ kind: 'movie', id: 10 });
    expect(searches[0].wantedLanguages).toEqual(['fra']);

    fixture.titleLanguages = {};
    await service.requestFor({ kind: 'movie', id: 11 });
    expect(searches[1].wantedLanguages).toEqual(['spa']);
  });

  it('merges regional variants of one language into its base code', async () => {
    fixture.titleLanguages = { u1: ['spa', 'SPA', 'eng'] };

    await service.requestFor({ kind: 'movie', id: 10 });

    expect(searches[0].wantedLanguages).toEqual(['spa', 'eng']);
  });

  it('writes no row when the owners want no language at all', async () => {
    fixture.userLanguages = { u1: [] };

    await service.requestFor({ kind: 'movie', id: 10 });

    expect(searches).toHaveLength(0);
  });

  it('supersedes an earlier non-terminal search of the same target and keeps terminal ones', async () => {
    searches.push(
      {
        id: 50,
        movieId: 10,
        status: 'WAITING',
        errorKey: null,
        wantedLanguages: ['spa'],
      },
      {
        id: 51,
        movieId: 10,
        status: 'COMPLETED',
        errorKey: null,
        wantedLanguages: ['spa'],
      },
      {
        id: 52,
        movieId: 99,
        status: 'WAITING',
        errorKey: null,
        wantedLanguages: ['spa'],
      },
    );
    nextId = 60;

    await service.requestFor({ kind: 'movie', id: 10 });

    expect(searches.find((row) => row.id === 50)).toMatchObject({
      status: 'FAILED',
      errorKey: ERROR_KEYS.SUBTITLE_SEARCH_SUPERSEDED,
    });
    expect(searches.find((row) => row.id === 51)?.status).toBe('COMPLETED');
    expect(searches.find((row) => row.id === 52)?.status).toBe('WAITING');
    expect(searches.find((row) => row.id === 60)?.status).toBe('WAITING');
  });

  it('never propagates a failure to the delivery that called it', async () => {
    fixture.available = true;
    const broken = new SubtitleSearchRequestService(
      {
        userMovie: {
          findMany: jest.fn().mockRejectedValue(new Error('db down')),
        },
      } as never,
      { isSubtitleSearchAvailable: jest.fn().mockResolvedValue(true) } as never,
      { wake } as never,
      { assertManualSearchPreflight: preflight } as never,
      mediaServer as never,
      mediaRoots as never,
    );

    await expect(
      broken.requestFor({ kind: 'movie', id: 10 }),
    ).resolves.toBeUndefined();
  });

  it('keeps the row when the first wake fails', async () => {
    wake.mockRejectedValue(new Error('redis down'));

    await expect(
      service.requestFor({ kind: 'movie', id: 10 }),
    ).resolves.toBeUndefined();

    expect(searches).toHaveLength(1);
  });

  describe('requestForCaller', () => {
    const movie = { kind: 'movie', id: 10 } as const;
    const keyOf = async (promise: Promise<unknown>) => {
      try {
        await promise;
        return null;
      } catch (error) {
        const body = (error as { getResponse(): { i18n?: { key: string } } })
          .getResponse();
        return body.i18n?.key ?? null;
      }
    };
    const runningRow = (): SearchRow => ({
      id: 50,
      movieId: 10,
      status: 'SEARCHING',
      errorKey: null,
      wantedLanguages: ['spa'],
    });

    // Spec 106, REQ-3 REQ-4 REQ-5 REQ-8
    it.each([
      ['no_file', ERROR_KEYS.SUBTITLE_EMBED_NO_FILE],
      ['not_mkv', ERROR_KEYS.SUBTITLE_EMBED_NOT_MKV],
      ['busy', ERROR_KEYS.SUBTITLE_EMBED_BUSY],
    ])(
      'surfaces the %s preflight refusal and creates no row and no wake',
      async (_name, key) => {
        preflight.mockRejectedValue(new BadRequestException(key));

        await expect(service.requestForCaller(movie, 'c1')).rejects.toThrow(
          key,
        );

        expect(searches).toHaveLength(0);
        expect(wake).not.toHaveBeenCalled();
        expect(transaction).not.toHaveBeenCalled();
      },
    );

    it('wants the caller languages with the preference off and ignores a non-opted-in owner', async () => {
      fixture.userMovies = [{ userId: 'u2', preference: false }];
      fixture.userLanguages = { c1: ['eng'], u2: ['ita'] };

      const id = await service.requestForCaller(movie, 'c1');

      expect(id).toBe(1);
      expect(searches[0].wantedLanguages).toEqual(['eng']);
    });

    it('unions the caller languages with the opted-in owners', async () => {
      fixture.userMovies = [{ userId: 'u1', preference: true }];
      fixture.userLanguages = { c1: ['eng'], u1: ['spa'] };

      await service.requestForCaller(movie, 'c1');

      expect([...searches[0].wantedLanguages].sort()).toEqual(['eng', 'spa']);
    });

    it('throws no_languages and creates nothing when the union is empty', async () => {
      fixture.userMovies = [];
      fixture.userLanguages = { c1: [] };

      await expect(keyOf(service.requestForCaller(movie, 'c1'))).resolves.toBe(
        ERROR_KEYS.SUBTITLE_SEARCH_NO_LANGUAGES,
      );

      expect(searches).toHaveLength(0);
      expect(wake).not.toHaveBeenCalled();
    });

    it('refuses with in_progress and leaves the running search untouched', async () => {
      searches.push(runningRow());

      await expect(keyOf(service.requestForCaller(movie, 'c1'))).resolves.toBe(
        ERROR_KEYS.SUBTITLE_SEARCH_IN_PROGRESS,
      );

      expect(searches).toEqual([runningRow()]);
      expect(wake).not.toHaveBeenCalled();
    });

    it('maps a serializable conflict to in_progress', async () => {
      transaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('conflict', {
          code: 'P2034',
          clientVersion: 'test',
        }),
      );

      await expect(keyOf(service.requestForCaller(movie, 'c1'))).resolves.toBe(
        ERROR_KEYS.SUBTITLE_SEARCH_IN_PROGRESS,
      );
    });

    it('wakes with no delay for a press and wakes a delivery at 0 too and supersedes', async () => {
      await service.requestForCaller(movie, 'u1');
      expect(wake).toHaveBeenLastCalledWith(1, 0);

      await service.requestFor({ kind: 'movie', id: 10 });
      expect(wake).toHaveBeenLastCalledWith(2, 0);
      expect(searches.find((row) => row.id === 1)).toMatchObject({
        status: 'FAILED',
        errorKey: ERROR_KEYS.SUBTITLE_SEARCH_SUPERSEDED,
      });
    });

    // Spec 107, REQ-4: a title Jellyfin or Plex holds but Perceptor never
    // delivered has no filePath; a row created without a resolvable path would
    // sit WAITING until the probe finds nothing to read, with no error shown.
    describe('press-time path for a title with no filePath', () => {
      const plexClient = (hostPath: string | null) => ({
        findByTmdbId: jest.fn().mockResolvedValue('77'),
        mediaHostPath: jest.fn().mockResolvedValue(hostPath),
      });
      beforeEach(() => {
        preflight.mockResolvedValue({ filePath: null, tmdbId: 603 });
      });

      it('no client -> no_library_path and no row', async () => {
        mediaServer.createClient.mockResolvedValue(null);

        await expect(
          keyOf(service.requestForCaller(movie, 'c1')),
        ).resolves.toBe(ERROR_KEYS.SUBTITLE_SEARCH_NO_LIBRARY_PATH);

        expect(searches).toHaveLength(0);
        expect(wake).not.toHaveBeenCalled();
      });

      it('title not found by the server -> no_library_path and no row', async () => {
        const client = plexClient('/host/lib/a.mkv');
        client.findByTmdbId.mockResolvedValue(null);
        mediaServer.createClient.mockResolvedValue(client);

        await expect(
          keyOf(service.requestForCaller(movie, 'c1')),
        ).resolves.toBe(ERROR_KEYS.SUBTITLE_SEARCH_NO_LIBRARY_PATH);
        expect(searches).toHaveLength(0);
      });

      it('Plex path -> the row carries libraryPath', async () => {
        const client = plexClient('/host/lib/Movie (2020).mkv');
        mediaServer.createClient.mockResolvedValue(client);

        await service.requestForCaller(movie, 'c1');

        expect(client.mediaHostPath).toHaveBeenCalledWith(
          '77',
          undefined,
          undefined,
        );
        expect(usable).toHaveBeenCalledWith('/lib/Movie (2020).mkv');
        expect(searches[0].libraryPath).toBe('/lib/Movie (2020).mkv');
      });

      it('passes season and episode numbers for an episode', async () => {
        preflight.mockResolvedValue({
          filePath: null,
          tmdbId: 5,
          seasonNumber: 2,
          episodeNumber: 3,
        });
        fixture.userLanguages = { c1: ['eng'] };
        const client = plexClient('/host/lib/E.mkv');
        mediaServer.createClient.mockResolvedValue(client);

        await service.requestForCaller({ kind: 'episode', id: 4 }, 'c1');

        expect(client.mediaHostPath).toHaveBeenCalledWith('77', 2, 3);
      });

      it('an unreachable server -> media_server_unavailable and no row', async () => {
        const client = plexClient(null);
        client.mediaHostPath.mockRejectedValue(new Error('ECONNREFUSED'));
        mediaServer.createClient.mockResolvedValue(client);

        await expect(
          keyOf(service.requestForCaller(movie, 'c1')),
        ).resolves.toBe(ERROR_KEYS.SUBTITLE_SEARCH_MEDIA_SERVER_UNAVAILABLE);
        expect(searches).toHaveLength(0);
      });

      it('a path outside the library -> outside_library and no row', async () => {
        mediaServer.createClient.mockResolvedValue(plexClient('/elsewhere/a.mkv'));

        await expect(
          keyOf(service.requestForCaller(movie, 'c1')),
        ).resolves.toBe(ERROR_KEYS.SUBTITLE_EMBED_OUTSIDE_LIBRARY);
        expect(searches).toHaveLength(0);
      });

      it('a title with a filePath never consults the media server', async () => {
        preflight.mockResolvedValue({ filePath: '/lib/a.mkv' });

        await service.requestForCaller(movie, 'c1');

        expect(mediaServer.createClient).not.toHaveBeenCalled();
        expect(searches[0].libraryPath).toBeUndefined();
      });
    });

    it('keeps the row and does not throw when the wake fails', async () => {
      wake.mockRejectedValue(new Error('redis down'));

      await expect(service.requestForCaller(movie, 'u1')).resolves.toBe(1);

      expect(searches).toHaveLength(1);
    });
  });
});
