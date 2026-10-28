import { HttpException } from '@nestjs/common';
import { TmdbListsService } from './tmdb-lists.service';
import { TmdbHttpError } from '@/clients/tmdb/errors';
import { ERROR_KEYS } from '@/i18n/error-keys';

// This service imports titles on a schedule with nobody watching, so every
// mistake here is silent: an item the user removed from Perceptor comes back
// on the next sweep (seen record not honoured), an item of a disabled type is
// marked seen and never imported once the type is enabled, an item whose
// registration failed is marked seen and never retried, one unreadable list
// stops every list after it, only the first page of a long list is read, or an
// owned title is registered again, a list page shows a title the list never
// brought in or one only another user owns, or a stored item count goes stale
// or is wiped by a failed read. The Prisma and TMDB boundaries are small
// in-memory fakes; the import logic under test is the real one.
type Item = { tmdbId: number; mediaType: 'movie' | 'show' };
type ListRow = {
  id: number;
  userId: string;
  tmdbListId: number;
  name: string;
  lastImportedAt: Date | null;
  lastError: string | null;
  itemCount?: number | null;
  createdAt: Date;
};

function errorKey(err: unknown): string {
  return (
    (
      (err as HttpException).getResponse() as {
        i18n?: { key?: string };
        key?: string;
      }
    ).i18n?.key ??
    (err as HttpException & { extensions?: { i18n?: { key?: string } } })
      .extensions?.i18n?.key ??
    ''
  );
}

function build(opts: {
  lists?: ListRow[];
  seen?: Record<number, string[]>;
  ownedMovies?: number[];
  ownedShows?: number[];
  apiKey?: string;
  disabled?: string[];
  pages?: Record<number, Item[][] | Error>;
  registerFails?: number[];
  itemCounts?: Record<number, number | null>;
  catalog?: {
    movie: { tmdbId: number; title: string; owners: string[] }[];
    show: { tmdbId: number; title: string; owners: string[] }[];
  };
}) {
  const lists = opts.lists ?? [];
  const seen: Record<number, Set<string>> = {};
  for (const [id, keys] of Object.entries(opts.seen ?? {}))
    seen[Number(id)] = new Set(keys);

  function catalogFind(type: 'movie' | 'show') {
    return async ({ where }: any) =>
      (opts.catalog?.[type] ?? [])
        .filter(
          (t) =>
            where.tmdbId.in.includes(t.tmdbId) &&
            t.owners.includes(where.users.some.userId),
        )
        .sort((a, b) => a.title.localeCompare(b.title));
  }

  const prisma = {
    userTmdbList: {
      findMany: jest.fn(async () => lists),
      findUnique: jest.fn(async () => null),
      create: jest.fn(async ({ data }) => ({ id: 99, ...data })),
      deleteMany: jest.fn(async () => ({ count: 0 })),
      update: jest.fn(async ({ where, data }) => {
        Object.assign(
          lists.find((l) => l.id === where.id)!,
          data,
        );
      }),
    },
    userTmdbListItem: {
      findMany: jest.fn(async ({ where }) =>
        [...(seen[where.listId] ?? [])].map((k) => {
          const [mediaType, id] = k.split(':');
          return { mediaType, tmdbId: Number(id) };
        }),
      ),
      upsert: jest.fn(async ({ create }) => {
        (seen[create.listId] ??= new Set()).add(
          `${create.mediaType}:${create.tmdbId}`,
        );
      }),
    },
    movie: { findMany: jest.fn(catalogFind('movie')) },
    show: { findMany: jest.fn(catalogFind('show')) },
    userMovie: {
      findMany: jest.fn(async () =>
        (opts.ownedMovies ?? []).map((tmdbId) => ({ movie: { tmdbId } })),
      ),
    },
    userShow: {
      findMany: jest.fn(async () =>
        (opts.ownedShows ?? []).map((tmdbId) => ({ show: { tmdbId } })),
      ),
    },
  };
  const settings = {
    getMap: jest.fn(async () => ({ movie_db_api_key: opts.apiKey ?? 'key' })),
  };
  const tmdb = {
    list: jest.fn(async (listId: number, page: number) => {
      const entry = opts.pages?.[listId] ?? [[]];
      if (entry instanceof Error) throw entry;
      return {
        name: `List ${listId}`,
        itemCount: opts.itemCounts?.[listId] ?? null,
        totalPages: entry.length,
        items: entry[page - 1] ?? [],
      };
    }),
  };
  const register = jest.fn(async (tmdbId: number) => {
    if (opts.registerFails?.includes(tmdbId)) throw new Error('not in catalog');
    return {};
  });
  const dispatch = { resolve: jest.fn(() => ({ register })) };
  const capabilities = {
    isEnabled: jest.fn(
      async (type: string) => !(opts.disabled ?? []).includes(type),
    ),
  };

  const service = new TmdbListsService(
    prisma as never,
    settings as never,
    tmdb as never,
    dispatch as never,
    capabilities as never,
  );
  return { service, prisma, tmdb, register, dispatch, seen, lists };
}

function list(id: number, tmdbListId: number, userId = 'u1'): ListRow {
  return {
    id,
    userId,
    tmdbListId,
    name: 'old',
    lastImportedAt: null,
    lastError: null,
    createdAt: new Date(2026, 0, id),
  };
}

describe('TmdbListsService.importAll', () => {
  it('does not register an item already seen, even though the user no longer owns it', async () => {
    const { service, register } = build({
      lists: [list(1, 10)],
      seen: { 1: ['movie:5'] },
      pages: { 10: [[{ tmdbId: 5, mediaType: 'movie' }]] },
    });
    const result = await service.importAll();
    expect(register).not.toHaveBeenCalled();
    expect(result.registered).toBe(0);
  });

  it('skips a disabled type and leaves it unseen so a later run imports it', async () => {
    const { service, register, seen } = build({
      lists: [list(1, 10)],
      disabled: ['show'],
      pages: {
        10: [
          [
            { tmdbId: 1, mediaType: 'movie' },
            { tmdbId: 2, mediaType: 'show' },
          ],
        ],
      },
    });
    await service.importAll();
    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith(1, 'u1');
    expect(seen[1]).toEqual(new Set(['movie:1']));
  });

  it('leaves a failed item unseen and still imports the rest of the list', async () => {
    const { service, register, seen } = build({
      lists: [list(1, 10)],
      registerFails: [1],
      pages: {
        10: [
          [
            { tmdbId: 1, mediaType: 'movie' },
            { tmdbId: 2, mediaType: 'movie' },
          ],
        ],
      },
    });
    const result = await service.importAll();
    expect(register).toHaveBeenCalledTimes(2);
    expect(seen[1]).toEqual(new Set(['movie:2']));
    expect(result.registered).toBe(1);
  });

  it('records a failing list and still imports the next one', async () => {
    const { service, lists, seen } = build({
      lists: [list(1, 10), list(2, 20)],
      pages: {
        10: new TmdbHttpError(404, 'gone'),
        20: [[{ tmdbId: 7, mediaType: 'movie' }]],
      },
    });
    const result = await service.importAll();
    expect(lists[0].lastError).toBe(ERROR_KEYS.TMDB_LIST_UNREADABLE);
    expect(lists[0].lastImportedAt).toBeNull();
    expect(lists[1].lastError).toBeNull();
    expect(lists[1].lastImportedAt).toBeInstanceOf(Date);
    expect(seen[2]).toEqual(new Set(['movie:7']));
    expect(result.listsFailed).toBe(1);
  });

  it('reads every page of a list, not only the first', async () => {
    const { service, tmdb, register } = build({
      lists: [list(1, 10)],
      pages: {
        10: [
          [{ tmdbId: 1, mediaType: 'movie' }],
          [{ tmdbId: 2, mediaType: 'show' }],
        ],
      },
    });
    await service.importAll();
    expect(tmdb.list).toHaveBeenCalledTimes(2);
    expect(register).toHaveBeenCalledTimes(2);
  });

  it('marks an owned item seen without calling register()', async () => {
    const { service, register, seen } = build({
      lists: [list(1, 10)],
      ownedMovies: [3],
      pages: { 10: [[{ tmdbId: 3, mediaType: 'movie' }]] },
    });
    const result = await service.importAll();
    expect(register).not.toHaveBeenCalled();
    expect(seen[1]).toEqual(new Set(['movie:3']));
    expect(result.registered).toBe(0);
  });

  it('makes no TMDB call and changes no list when the catalog key is empty', async () => {
    const { service, tmdb, prisma } = build({
      lists: [list(1, 10)],
      apiKey: '  ',
    });
    await service.importAll();
    expect(tmdb.list).not.toHaveBeenCalled();
    expect(prisma.userTmdbList.update).not.toHaveBeenCalled();
  });

  it('stores catalog_unauthorized when TMDB answers status_code 7, unreadable for any other 401', async () => {
    const { service, lists } = build({
      lists: [list(1, 10), list(2, 20)],
      pages: {
        10: new TmdbHttpError(401, 'bad key', 7),
        20: new TmdbHttpError(401, 'private', 36),
      },
    });
    await service.importAll();
    expect(lists[0].lastError).toBe(ERROR_KEYS.MEDIA_CATALOG_UNAUTHORIZED);
    expect(lists[1].lastError).toBe(ERROR_KEYS.TMDB_LIST_UNREADABLE);
  });
});

describe('TmdbListsService.attach', () => {
  it('refuses a private list (404 or a non-key 401) as unreadable and stores nothing', async () => {
    for (const err of [
      new TmdbHttpError(404, 'x'),
      new TmdbHttpError(401, 'x', 36),
    ]) {
      const { service, prisma } = build({ pages: { 10: err } });
      const caught = await service.attach('u1', '10').catch((e) => e);
      expect(errorKey(caught)).toBe(ERROR_KEYS.TMDB_LIST_UNREADABLE);
      expect(prisma.userTmdbList.create).not.toHaveBeenCalled();
    }
  });

  it('answers catalog_unauthorized for status_code 7 and for an empty key without calling TMDB', async () => {
    const rejected = build({ pages: { 10: new TmdbHttpError(401, 'x', 7) } });
    expect(
      errorKey(await rejected.service.attach('u1', '10').catch((e) => e)),
    ).toBe(ERROR_KEYS.MEDIA_CATALOG_UNAUTHORIZED);

    const empty = build({ apiKey: '' });
    expect(
      errorKey(await empty.service.attach('u1', '10').catch((e) => e)),
    ).toBe(ERROR_KEYS.MEDIA_CATALOG_UNAUTHORIZED);
    expect(empty.tmdb.list).not.toHaveBeenCalled();
  });
});

describe('TmdbListsService item count', () => {
  it('stores the count on attach', async () => {
    const { service, prisma } = build({ itemCounts: { 10: 42 } });
    await service.attach('u1', '10');
    expect(prisma.userTmdbList.create).toHaveBeenCalledWith({
      data: { userId: 'u1', tmdbListId: 10, name: 'List 10', itemCount: 42 },
    });
  });

  it('refreshes the count on a successful read and leaves it untouched on a failed one', async () => {
    const ok = list(1, 10);
    ok.itemCount = 1;
    const bad = list(2, 20);
    bad.itemCount = 7;
    const { service, lists } = build({
      lists: [ok, bad],
      itemCounts: { 10: 5 },
      pages: { 20: new TmdbHttpError(503, 'down') },
    });
    await service.importAll();
    expect(lists[0].itemCount).toBe(5);
    expect(lists[1].itemCount).toBe(7);
  });
});

describe('TmdbListsService.ownedTitles', () => {
  it('returns only titles both seen by the list and owned by the caller, ordered by title', async () => {
    const { service } = build({
      seen: { 1: ['movie:1', 'movie:2', 'movie:3', 'show:9'] },
      catalog: {
        movie: [
          { tmdbId: 1, title: 'Zulu', owners: ['u1'] },
          { tmdbId: 2, title: 'Alpha', owners: ['u1', 'u2'] },
          { tmdbId: 3, title: 'Other users only', owners: ['u2'] },
          { tmdbId: 4, title: 'Owned but not in list', owners: ['u1'] },
        ],
        show: [{ tmdbId: 9, title: 'A show', owners: ['u1'] }],
      },
    });
    const movies = await service.ownedTitles('u1', 1, 'movie');
    expect(movies.map((m: any) => m.title)).toEqual(['Alpha', 'Zulu']);
    const shows = await service.ownedTitles('u1', 1, 'show');
    expect(shows.map((m: any) => m.title)).toEqual(['A show']);
  });
});
