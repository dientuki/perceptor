import { SubtitleSearchRequestService } from './subtitle-search-request.service';
import { ERROR_KEYS } from '@/i18n/error-keys';

type SearchRow = {
  id: number;
  movieId?: number;
  episodeId?: number;
  status: string;
  errorKey: string | null;
  wantedLanguages: string[];
};

type Fixture = {
  available: boolean;
  userMovies: Array<{
    userId: string;
    subtitleSearch: boolean;
    userFlag: boolean;
  }>;
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
  let fixture: Fixture;
  let service: SubtitleSearchRequestService;
  let nextId: number;

  const language = (iso3: string) => ({ language: { iso3 } });

  beforeEach(() => {
    searches = [];
    nextId = 1;
    wake = jest.fn().mockResolvedValue(undefined);
    fixture = {
      available: true,
      userMovies: [{ userId: 'u1', subtitleSearch: true, userFlag: true }],
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

    const prisma = {
      userMovie: {
        findMany: jest.fn(() =>
          Promise.resolve(
            fixture.userMovies
              .filter((row) => row.subtitleSearch && row.userFlag)
              .map((row) => ({ userId: row.userId })),
          ),
        ),
      },
      userShow: { findMany: jest.fn().mockResolvedValue([]) },
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
      userShowLanguage: { findMany: jest.fn().mockResolvedValue([]) },
      userLanguagePreference: {
        findMany: jest.fn(({ where }: { where: { userId: string } }) =>
          Promise.resolve(
            (fixture.userLanguages[where.userId] ?? []).map(language),
          ),
        ),
      },
      subtitleSearch: { create, updateMany },
      $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) =>
        fn({ subtitleSearch: { create, updateMany } }),
      ),
    };
    const capabilities = {
      isSubtitleSearchAvailable: jest.fn(() =>
        Promise.resolve(fixture.available),
      ),
    };

    service = new SubtitleSearchRequestService(
      prisma as never,
      capabilities as never,
      { wake } as never,
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
    expect(wake).toHaveBeenCalledWith(1, expect.any(Number));
  });

  it('writes no row when the media server is not Jellyfin', async () => {
    fixture.available = false;

    await service.requestFor({ kind: 'movie', id: 10 });

    expect(searches).toHaveLength(0);
    expect(wake).not.toHaveBeenCalled();
  });

  it('writes no row when the title flag is on but the user preference is off', async () => {
    fixture.userMovies = [
      { userId: 'u1', subtitleSearch: true, userFlag: false },
    ];

    await service.requestFor({ kind: 'movie', id: 10 });

    expect(searches).toHaveLength(0);
  });

  it('writes no row when no owner opted in on the title', async () => {
    fixture.userMovies = [
      { userId: 'u1', subtitleSearch: false, userFlag: true },
    ];

    await service.requestFor({ kind: 'movie', id: 10 });

    expect(searches).toHaveLength(0);
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
});
