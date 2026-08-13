import { Test, TestingModule } from '@nestjs/testing';
import { ShowsService } from './shows.service';
import { PrismaService } from '@/prisma/prisma.service';
import { RedisService } from '@/redis/redis.service';
import { TmdbClient, posterUrl } from '@/clients/tmdb/client';
import { MEDIA_TYPE } from '@/types/media';

// This suite exists because ShowsService's riskiest paths all fail with a
// perfectly successful response and nothing to notice:
//
//  - a reordering that enriches search results with this caller's ownership
//    before writing them to Redis leaks one user's `inLibrary`/`mediaId`
//    into a cache key shared by every user who searches the same series for
//    the next 24 hours — the return value of search() looks identical
//    either way, so only asserting on what is actually handed to the Redis
//    pipeline can catch it. `005-movie-search` already has this case for
//    films, but the ordering is implemented separately in ShowsService, so
//    it can be broken separately with nothing failing (NFR-3) — that is why
//    this feature demands the case here too, not just once in the film
//    suite;
//  - `enrichWithOwnership` dropping (or never applying) its per-caller
//    filter on `users` would report every registered series as owned by
//    every caller, or none as owned by anyone — a mocked Prisma returns
//    whatever it is told regardless of the query it was actually given, so
//    only the call arguments can catch the filter going missing;
//  - `register` on a series someone already registered either creates a
//    second `Show` row (a second, redundant hydration of the same series)
//    or throws a raw Prisma P2002 the second time the same user clicks it;
//  - a hydration that marks `seasonsSyncedAt` before every season and
//    episode has actually been written makes a half-populated series
//    permanently indistinguishable from a complete one — REQ-14's retry
//    path never fires again for it — and a claim key left behind after a
//    failed hydration silently disables every future retry until the TTL
//    expires (NFR-4 / NFR-5);
//  - `findOneFromDb` dropping (or never applying) its `user_shows` scope
//    would resolve a series (and its seasons/episodes) for any authenticated
//    caller, not just the one linked to it — the query still succeeds,
//    `show(id)` still returns a real record with real seasons, and the page
//    renders correctly; the only wrong thing is whose library it came from
//    (009-show-detail). A missing `orderBy` on the nested seasons/episodes
//    include is the same class of bug one level deeper: episodes render in
//    whatever order the DB happens to return them, silently, until a
//    re-hydration or manual edit reorders the underlying rows and nothing
//    anywhere reports it.
describe('ShowsService', () => {
  let service: ShowsService;
  let prisma: {
    show: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    season: { upsert: jest.Mock };
    episode: { upsert: jest.Mock };
    userShow: { upsert: jest.Mock };
  };
  let redis: {
    get: jest.Mock;
    pipeline: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
  };
  let tmdb: {
    search: jest.Mock;
    details: jest.Mock;
    seasonDetails: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      show: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      season: { upsert: jest.fn() },
      episode: { upsert: jest.fn() },
      userShow: { upsert: jest.fn() },
    };
    redis = {
      get: jest.fn(),
      pipeline: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    };
    tmdb = {
      search: jest.fn(),
      details: jest.fn(),
      seasonDetails: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShowsService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
        { provide: TmdbClient, useValue: tmdb },
      ],
    }).compile();

    service = module.get<ShowsService>(ShowsService);
  });

  // The failure this block defends against is a cross-user leak with no
  // error anywhere: a findAll that stops filtering through the user_shows
  // join returns every registered series to every caller, and nothing
  // notices. The query succeeds, `shows` resolves a non-empty list, the
  // page renders a grid of real series with real posters — the only wrong
  // thing about the response is whose library it is. A mocked Prisma hands
  // back whatever it was told regardless of the query it was actually
  // given, so the call arguments are the only observable that can catch the
  // filter going missing or being hardcoded to some other id.
  describe('findAll', () => {
    it('scopes the query to the caller through the user_shows join', async () => {
      prisma.show.findMany.mockResolvedValue([{ id: 1, title: 'Mine' }]);

      await service.findAll('user-1');

      expect(prisma.show.findMany).toHaveBeenCalledTimes(1);
      const [args] = prisma.show.findMany.mock.calls[0];
      expect(args.where).toEqual({ users: { some: { userId: 'user-1' } } });
    });

    it('returns the most recently added series first', async () => {
      prisma.show.findMany.mockResolvedValue([]);

      await service.findAll('user-1');

      const [args] = prisma.show.findMany.mock.calls[0];
      expect(args.orderBy).toEqual({ createdAt: 'desc' });
    });

    it('returns an empty list for a user with no series', async () => {
      // REQ-4: an empty library is not an error and not null — `shows` is
      // `[Show!]!`, so a null here would surface in web as a GraphQL
      // non-null violation instead of an empty grid.
      prisma.show.findMany.mockResolvedValue([]);

      await expect(service.findAll('user-without-series')).resolves.toEqual([]);
    });
  });

  describe('findOneFromDb', () => {
    it('scopes the query to the caller through the user_shows join', async () => {
      prisma.show.findFirst.mockResolvedValue({ id: 7, title: 'Mine' });

      await service.findOneFromDb(7, 'user-1');

      // The failure mode here is a query that resolves a series for any
      // authenticated caller, not just the one linked to it: asserting the
      // where-clause is the only way a mocked Prisma can catch it, since the
      // mock returns whatever we told it to regardless of what it was
      // actually asked for. A version that keeps `where: { id }` and moves
      // the join into `include` would pass a looser, `objectContaining`
      // assertion while being entirely unscoped — hence full equality.
      expect(prisma.show.findFirst).toHaveBeenCalledTimes(1);
      const [args] = prisma.show.findFirst.mock.calls[0];
      expect(args.where).toEqual({ id: 7, users: { some: { userId: 'user-1' } } });
    });

    it('returns null for a series the caller is not linked to', async () => {
      prisma.show.findFirst.mockResolvedValue(null);

      await expect(service.findOneFromDb(7, 'user-2')).resolves.toBeNull();
    });

    it('returns the same null for an id that does not exist', async () => {
      // NFR-1: an unowned series and a missing one must be indistinguishable
      // from the caller's side — both resolve through the identical query
      // shape above and both come back null.
      prisma.show.findFirst.mockResolvedValue(null);

      await expect(service.findOneFromDb(999999999, 'user-1')).resolves.toBeNull();
    });

    it('orders seasons and episodes server-side, ascending', async () => {
      prisma.show.findFirst.mockResolvedValue({ id: 7, title: 'Mine', seasons: [] });

      await service.findOneFromDb(7, 'user-1');

      // NFR-2: episodes rendering in the wrong order is a silent failure —
      // nothing throws, the page just looks wrong. Asserting the shape of
      // the `include` passed to Prisma is the only way a mocked client can
      // catch a dropped or misplaced `orderBy`.
      const [args] = prisma.show.findFirst.mock.calls[0];
      expect(args.include.seasons.orderBy).toEqual({ seasonNumber: 'asc' });
      expect(args.include.seasons.include.episodes.orderBy).toEqual({ episodeNumber: 'asc' });
    });
  });

  describe('search', () => {
    it("hands Redis a catalog-only object, never this caller's ownership", async () => {
      tmdb.search.mockResolvedValue([
        {
          id: 42,
          name: 'Breaking Bad',
          first_air_date: '2008-01-20',
          poster_path: '/bb.jpg',
          original_language: 'en',
          overview: 'A chemistry teacher turns to crime.',
        },
      ]);
      // Someone else already registered this series too, so
      // enrichWithOwnership has real, non-default values to smuggle into
      // the cache if the ordering were ever broken.
      prisma.show.findMany.mockResolvedValue([
        { id: 7, tmdbId: 42, users: [{ userId: 'user-1' }] },
      ]);
      const pipelineSet = jest.fn().mockReturnThis();
      const pipelineExec = jest.fn().mockResolvedValue([[null, 'OK']]);
      redis.pipeline.mockReturnValue({ set: pipelineSet, exec: pipelineExec });

      const results = await service.search('breaking bad', 'user-1');

      // Sanity check: the returned value is correctly enriched either way —
      // this is exactly why the assertion below has to look at the Redis
      // call, not at this.
      expect(results).toEqual([
        expect.objectContaining({ id: 42, mediaId: 7, inLibrary: true }),
      ]);

      expect(pipelineSet).toHaveBeenCalledTimes(1);
      const [cacheKey, cachedJson] = pipelineSet.mock.calls[0];
      expect(cacheKey).toBe('tmdb:show:42');
      const cached = JSON.parse(cachedJson);
      expect(cached).not.toHaveProperty('mediaId');
      expect(cached).not.toHaveProperty('inLibrary');
      expect(cached).toEqual({
        id: 42,
        title: 'Breaking Bad',
        releaseDate: '2008-01-20',
        posterUrl: posterUrl('/bb.jpg'),
        originalLanguage: 'en',
        overview: 'A chemistry teacher turns to crime.',
        type: MEDIA_TYPE.SHOW,
      });
    });

    it('scopes ownership to the caller through a per-user filter on `users`, not a global one', async () => {
      // The listing path's scoping is covered by the findAll block above,
      // and there is still no `show(id)` query — so the *other* place this
      // service computes per-caller ownership is enrichWithOwnership, and
      // that is where the search path's caller-scoping bug would land: a
      // query that forgets `where: { userId }` on the `users` relation
      // reports every registered series as owned by every caller.
      tmdb.search.mockResolvedValue([
        {
          id: 42,
          name: 'Breaking Bad',
          first_air_date: '2008-01-20',
          poster_path: '/bb.jpg',
          original_language: 'en',
          overview: 'A chemistry teacher turns to crime.',
        },
      ]);
      prisma.show.findMany.mockResolvedValue([]);
      const pipelineSet = jest.fn().mockReturnThis();
      const pipelineExec = jest.fn().mockResolvedValue([[null, 'OK']]);
      redis.pipeline.mockReturnValue({ set: pipelineSet, exec: pipelineExec });

      await service.search('breaking bad', 'user-1');

      // A mocked Prisma returns whatever it was told regardless of what it
      // was actually asked for, so the call arguments are the only
      // observable that can catch the filter going missing.
      expect(prisma.show.findMany).toHaveBeenCalledWith({
        where: { tmdbId: { in: [42] } },
        select: {
          id: true,
          tmdbId: true,
          users: { where: { userId: 'user-1' }, select: { userId: true } },
        },
      });
    });
  });

  describe('register', () => {
    it('links the caller to an already-registered series, creates no second row, and tolerates a repeat', async () => {
      const existing = { id: 5, tmdbId: 42, title: 'Breaking Bad', seasonsSyncedAt: new Date() };
      prisma.show.findUnique.mockResolvedValue(existing);
      prisma.userShow.upsert.mockResolvedValue({ userId: 'user-1', showId: 5 });

      const first = await service.register(42, 'user-1');
      const second = await service.register(42, 'user-1');

      expect(first).toEqual({ id: 5, type: MEDIA_TYPE.SHOW });
      expect(second).toEqual({ id: 5, type: MEDIA_TYPE.SHOW });
      expect(prisma.show.create).not.toHaveBeenCalled();
      expect(prisma.userShow.upsert).toHaveBeenCalledTimes(2);
      expect(prisma.userShow.upsert).toHaveBeenNthCalledWith(1, {
        where: { userId_showId: { userId: 'user-1', showId: 5 } },
        update: {},
        create: { userId: 'user-1', showId: 5 },
      });
      expect(prisma.userShow.upsert).toHaveBeenNthCalledWith(2, {
        where: { userId_showId: { userId: 'user-1', showId: 5 } },
        update: {},
        create: { userId: 'user-1', showId: 5 },
      });
    });
  });

  describe('hydrate (detached from register)', () => {
    // register() fires `void this.hydrate(...)` without awaiting it
    // (REQ-13) — flushing the microtask queue is the only way to observe
    // hydrate's own outcome from a test without changing that fire-and-
    // forget shape in production code. All the mocks below resolve/reject
    // through native promises with no real I/O, so a `setImmediate` flush
    // (which only runs once the microtask queue is fully drained) is enough
    // to let the whole chained try/catch/finally settle.
    const flushPromises = () => new Promise(resolve => setImmediate(resolve));

    it('never marks seasonsSyncedAt when a season fetch fails partway through, and always releases the claim', async () => {
      prisma.show.findUnique.mockResolvedValue(null); // not registered yet
      redis.get.mockResolvedValue(null); // cold cache — falls back to the catalog
      redis.set.mockResolvedValue('OK'); // wins the hydration claim
      redis.del.mockResolvedValue(1);

      const detail = {
        type: MEDIA_TYPE.SHOW,
        id: 42,
        title: 'Breaking Bad',
        originalTitle: 'Breaking Bad',
        overview: 'A chemistry teacher turns to crime.',
        posterPath: '/bb.jpg',
        backdropPath: '/bb-backdrop.jpg',
        originalLanguage: 'en',
        voteAverage: 9.5,
        status: 'Ended',
        firstAirDate: '2008-01-20',
        numberOfSeasons: 2,
        numberOfEpisodes: 20,
        seasons: [
          { id: 1, name: 'Season 1', seasonNumber: 1, episodeCount: 7, releaseDate: '2008-01-20', overview: '', posterPath: '' },
          { id: 2, name: 'Season 2', seasonNumber: 2, episodeCount: 13, releaseDate: '2009-03-08', overview: '', posterPath: '' },
        ],
      };
      tmdb.details.mockResolvedValue(detail);
      prisma.show.create.mockResolvedValue({ id: 9, tmdbId: 42, title: 'Breaking Bad' });
      prisma.userShow.upsert.mockResolvedValue({ userId: 'user-1', showId: 9 });
      prisma.season.upsert.mockImplementation(({ create }: { create: { seasonNumber: number } }) =>
        Promise.resolve({ id: create.seasonNumber, showId: 9, seasonNumber: create.seasonNumber }),
      );
      prisma.episode.upsert.mockResolvedValue({});

      // Season 1 hydrates cleanly; season 2's episode fetch fails — the
      // exact partial-fetch shape REQ-14 exists for.
      tmdb.seasonDetails.mockImplementation((_tmdbId: number, seasonNumber: number) => {
        if (seasonNumber === 2) return Promise.reject(new Error('TMDB rate limited'));
        return Promise.resolve([
          { id: 1, title: 'Pilot', overview: '...', releaseDate: '2008-01-20', episodeNumber: 1, stillPath: null, voteAverage: 8.9 },
        ]);
      });

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await service.register(42, 'user-1');
      // hydrate() is fired but never awaited by register(); give its
      // detached try/catch/finally a couple of microtask flushes to run to
      // completion before asserting on it.
      await flushPromises();
      await flushPromises();

      expect(prisma.season.upsert).toHaveBeenCalledTimes(2); // both seasons' rows were attempted
      expect(prisma.episode.upsert).toHaveBeenCalledTimes(1); // only season 1's single episode was written

      // The bug this case defends against: a partial fetch that marks
      // itself complete is permanently invisible — REQ-14's retry would
      // never fire again for this series.
      expect(prisma.show.update).not.toHaveBeenCalled();

      // The bug NFR-5 warns about: a claim left behind after a failed
      // hydration silently disables every future retry until the TTL
      // expires.
      expect(redis.del).toHaveBeenCalledWith('show:hydrate:42');

      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });
});
