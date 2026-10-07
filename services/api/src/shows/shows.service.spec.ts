import { Test, TestingModule } from '@nestjs/testing';
import { ShowsService } from './shows.service';
import { PrismaService } from '@/prisma/prisma.service';
import { RedisService } from '@/redis/redis.service';
import { TmdbClient, posterUrl } from '@/clients/tmdb/client';
import { MediaServerReconcileService } from '@/media-server/media-server-reconcile.service';
import { MEDIA_TYPE } from '@/types/media';
import { DownloadsService } from '@/downloads/downloads.service';
import { CatalogSearchService } from '@/media/catalog-search.service';
import { ERROR_KEYS } from '@/i18n/error-keys';

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
//    it can be broken separately with nothing failing (Spec 006, NFR-3) — that is why
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
//    permanently indistinguishable from a complete one — Spec 006, REQ-14's retry
//    path never fires again for it — and a claim key left behind after a
//    failed hydration silently disables every future retry until the TTL
//    expires (Spec 006, NFR-4 NFR-5);
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
      delete: jest.Mock;
    };
    season: { upsert: jest.Mock };
    episode: { upsert: jest.Mock };
    userShow: { upsert: jest.Mock; count: jest.Mock; delete: jest.Mock };
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
    keywords: jest.Mock;
  };
  let mediaServerReconcile: {
    reconcileShow: jest.Mock;
  };
  let downloads: { unwindSourcesForTitle: jest.Mock };

  beforeEach(async () => {
    prisma = {
      show: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      season: { upsert: jest.fn() },
      episode: { upsert: jest.fn() },
      userShow: { upsert: jest.fn(), count: jest.fn(), delete: jest.fn() },
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
      keywords: jest.fn(),
    };
    mediaServerReconcile = {
      reconcileShow: jest.fn().mockResolvedValue(undefined),
    };

    downloads = { unwindSourcesForTitle: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShowsService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
        { provide: TmdbClient, useValue: tmdb },
        {
          provide: MediaServerReconcileService,
          useValue: mediaServerReconcile,
        },
        { provide: DownloadsService, useValue: downloads },
        {
          // 088-acquisition-path-unification: the real CatalogSearchService,
          // wired to this suite's own prisma/redis/tmdb mocks, so the cache
          // ordering assertions below keep exercising the actual shared
          // implementation rather than a stub that could drift from it.
          provide: CatalogSearchService,
          useFactory: () =>
            new CatalogSearchService(
              prisma as unknown as PrismaService,
              redis as unknown as RedisService,
              tmdb as unknown as TmdbClient,
            ),
        },
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
  describe('findEpisodesReleasedBetween', () => {
    it('scopes to shows the caller owns and passes the date bounds to Prisma', async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      (prisma.episode as unknown as { findMany: jest.Mock }).findMany = findMany;
      const from = new Date('2026-09-01T00:00:00Z');
      const toExclusive = new Date('2026-10-01T00:00:00Z');

      await service.findEpisodesReleasedBetween('user-1', from, toExclusive);

      expect(findMany).toHaveBeenCalledTimes(1);
      const [args] = findMany.mock.calls[0];
      expect(args.where).toEqual({
        releaseDate: { gte: from, lt: toExclusive },
        season: { show: { users: { some: { userId: 'user-1' } } } },
      });
    });

    // Spec 089, REQ-6
    it("returns the episode's stored status column directly, with no derivation", async () => {
      const findMany = jest.fn().mockResolvedValue([
        {
          id: 101,
          episodeNumber: 1,
          title: 'Pilot',
          status: 'DOWNLOADING',
          releaseDate: new Date('2026-09-15'),
          season: {
            seasonNumber: 1,
            show: { id: 7, title: 'Mine' },
          },
        },
      ]);
      (prisma.episode as unknown as { findMany: jest.Mock }).findMany = findMany;

      const result = await service.findEpisodesReleasedBetween(
        'user-1',
        new Date('2026-09-01T00:00:00Z'),
        new Date('2026-10-01T00:00:00Z'),
      );

      expect(result[0].status).toBe('DOWNLOADING');
    });
  });

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
      // Spec 007, REQ-4
      prisma.show.findMany.mockResolvedValue([]);

      await expect(service.findAll('user-without-series')).resolves.toEqual([]);
    });
  });

  describe('findOneFromDb', () => {
    it('scopes the query to the caller through the user_shows join', async () => {
      prisma.show.findFirst.mockResolvedValue({ id: 7, title: 'Mine', seasons: [] });

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
      expect(args.where).toEqual({
        id: 7,
        users: { some: { userId: 'user-1' } },
      });
    });

    it('returns null for a series the caller is not linked to', async () => {
      prisma.show.findFirst.mockResolvedValue(null);

      await expect(service.findOneFromDb(7, 'user-2')).resolves.toBeNull();
    });

    it('returns the same null for an id that does not exist', async () => {
      // Spec 009, NFR-1
      prisma.show.findFirst.mockResolvedValue(null);

      await expect(
        service.findOneFromDb(999999999, 'user-1'),
      ).resolves.toBeNull();
    });

    it('orders seasons and episodes server-side, ascending', async () => {
      prisma.show.findFirst.mockResolvedValue({
        id: 7,
        title: 'Mine',
        seasons: [],
      });

      await service.findOneFromDb(7, 'user-1');

      // Spec 009, NFR-2
      const [args] = prisma.show.findFirst.mock.calls[0];
      expect(args.include.seasons.orderBy).toEqual({ seasonNumber: 'asc' });
      expect(args.include.seasons.include.episodes.orderBy).toEqual({
        episodeNumber: 'asc',
      });
    });

    // Spec 059, T003
    it("filters the season's mediaSources include to non-ERROR", async () => {
      prisma.show.findFirst.mockResolvedValue({ id: 7, title: 'Mine', seasons: [] });

      await service.findOneFromDb(7, 'user-1');

      const [args] = prisma.show.findFirst.mock.calls[0];
      expect(args.include.seasons.include.mediaSources).toEqual({
        where: { status: { not: 'ERROR' } },
      });
    });

    // Spec 089, REQ-6
    it("returns each episode's stored status column directly, with no derivation", async () => {
      prisma.show.findFirst.mockResolvedValue({
        id: 7,
        title: 'Mine',
        seasons: [
          {
            id: 1,
            seasonNumber: 1,
            episodes: [
              {
                id: 101,
                episodeNumber: 1,
                status: 'QUEUED',
              },
            ],
          },
        ],
      });

      const result = await service.findOneFromDb(7, 'user-1');

      expect(result?.seasons[0].episodes[0].status).toBe('QUEUED');
    });
  });

  // These tests exist because both removal branches "succeed": picking the
  // wrong one either deletes a series out from under another user who still
  // owns it, or leaves a series nobody owns (with live torrents) behind, and
  // neither raises an error anywhere. The series unwind is delegated to
  // DownloadsService.unwindSourcesForTitle({ showId }), whose own suite
  // covers collecting season-pack and per-episode sources together; here we
  // pin that the series path asks for exactly that scope.
  describe('remove', () => {
    const owned = { id: 5, seasons: [] };

    it('drops only the caller row and never unwinds when another user still owns the series', async () => {
      prisma.show.findFirst.mockResolvedValue(owned);
      prisma.userShow.count.mockResolvedValue(1);

      const result = await service.remove(5, 'user-1');

      expect(prisma.userShow.count).toHaveBeenCalledWith({ where: { showId: 5, userId: { not: 'user-1' } } });
      expect(prisma.userShow.delete).toHaveBeenCalledWith({ where: { userId_showId: { userId: 'user-1', showId: 5 } } });
      expect(downloads.unwindSourcesForTitle).not.toHaveBeenCalled();
      expect(prisma.show.delete).not.toHaveBeenCalled();
      expect(result).toEqual({ deleted: false, remainingOwners: 1 });
    });

    it('unwinds by showId (season packs and episodes) and only then deletes the series for the last owner', async () => {
      prisma.show.findFirst.mockResolvedValue(owned);
      prisma.userShow.count.mockResolvedValue(0);

      const result = await service.remove(5, 'user-1');

      expect(downloads.unwindSourcesForTitle).toHaveBeenCalledWith({ showId: 5 });
      expect(downloads.unwindSourcesForTitle.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.show.delete.mock.invocationCallOrder[0],
      );
      expect(prisma.show.delete).toHaveBeenCalledWith({ where: { id: 5 } });
      expect(result).toEqual({ deleted: true, remainingOwners: 0 });
    });

    it('keeps the series when the torrent client rejects the unwind', async () => {
      prisma.show.findFirst.mockResolvedValue(owned);
      prisma.userShow.count.mockResolvedValue(0);
      downloads.unwindSourcesForTitle.mockRejectedValue(new Error('rejected'));

      await expect(service.remove(5, 'user-1')).rejects.toThrow('rejected');
      expect(prisma.show.delete).not.toHaveBeenCalled();
    });

    it('refuses a series the caller does not own, or one already removed, and deletes nothing', async () => {
      prisma.show.findFirst.mockResolvedValue(null);

      await expect(service.remove(5, 'user-2')).rejects.toMatchObject({
        response: { i18n: { key: ERROR_KEYS.SHOW_NOT_AVAILABLE } },
      });
      expect(prisma.userShow.delete).not.toHaveBeenCalled();
      expect(prisma.show.delete).not.toHaveBeenCalled();
      expect(downloads.unwindSourcesForTitle).not.toHaveBeenCalled();
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
        expect.objectContaining({
          id: 42,
          mediaId: 7,
          inLibrary: true,
          isShort: false,
        }),
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
      const existing = {
        id: 5,
        tmdbId: 42,
        title: 'Breaking Bad',
        seasonsSyncedAt: new Date(),
      };
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

  // Spec 057, REQ-6: ShowsService.register() derives a
  // fresh series' contentKind by the same genre-then-keywords rule as
  // MoviesService. Every case here defends against a class of bug that
  // produces a perfectly valid ContentKind and a wrongly-tuned encode nobody
  // notices until they watch the file — a mistuned precedence, a stray
  // second TMDB request, or a leaked contentKind in the shared cache all
  // look identical to a passing registration unless asserted on directly.
  describe('register (fresh series) — content kind derivation', () => {
    const pipelineSet = jest.fn().mockReturnThis();
    const pipelineExec = jest.fn().mockResolvedValue([[null, 'OK']]);

    beforeEach(() => {
      prisma.show.findUnique.mockResolvedValue(null); // not registered yet
      prisma.userShow.upsert.mockResolvedValue({ userId: 'user-1', showId: 9 });
      prisma.show.create.mockResolvedValue({
        id: 9,
        tmdbId: 42,
        title: 'Some Series',
      });
      // hydrate() is fired detached and must not affect any assertion here —
      // losing the claim makes it return immediately without touching tmdb
      // or prisma any further.
      redis.set.mockResolvedValue(null);
      pipelineSet.mockClear();
      pipelineExec.mockClear();
      redis.pipeline.mockReturnValue({ set: pipelineSet, exec: pipelineExec });
    });

    function cachedEntry(overrides: Record<string, unknown> = {}) {
      return JSON.stringify({
        id: 42,
        title: 'Some Series',
        releaseDate: '2020-01-01',
        posterUrl: null,
        originalLanguage: 'en',
        overview: '...',
        type: MEDIA_TYPE.SHOW,
        ...overrides,
      });
    }

    it('derives LIVE_ACTION for a non-animated series and never requests keywords (REQ-2)', async () => {
      redis.get.mockResolvedValue(cachedEntry({ genreIds: [18] })); // Drama

      await service.register(42, 'user-1');

      expect(prisma.show.create).toHaveBeenCalledTimes(1);
      const [{ data }] = prisma.show.create.mock.calls[0];
      expect(data.contentKind).toBe('LIVE_ACTION');
      expect(tmdb.keywords).not.toHaveBeenCalled();
      expect(tmdb.details).not.toHaveBeenCalled();
    });

    it('derives ANIME for an animated series whose keywords include the anime id (REQ-3)', async () => {
      redis.get.mockResolvedValue(cachedEntry({ genreIds: [16] })); // Animation
      tmdb.keywords.mockResolvedValue([210024]);

      await service.register(42, 'user-1');

      const [{ data }] = prisma.show.create.mock.calls[0];
      expect(data.contentKind).toBe('ANIME');
      expect(tmdb.keywords).toHaveBeenCalledWith(MEDIA_TYPE.SHOW, 42);
    });

    it('derives CGI when both 3d-animation and anime keywords are present (REQ-4 precedence)', async () => {
      redis.get.mockResolvedValue(cachedEntry({ genreIds: [16] }));
      tmdb.keywords.mockResolvedValue([210024, 278823]);

      await service.register(42, 'user-1');

      const [{ data }] = prisma.show.create.mock.calls[0];
      expect(data.contentKind).toBe('CGI');
    });

    it('derives CGI for an animated series with an already-cached, empty keyword list, without a fresh request (REQ-5)', async () => {
      redis.get.mockResolvedValue(
        cachedEntry({ genreIds: [16], keywordIds: [] }),
      );

      await service.register(42, 'user-1');

      const [{ data }] = prisma.show.create.mock.calls[0];
      expect(data.contentKind).toBe('CGI');
      expect(tmdb.keywords).not.toHaveBeenCalled();
    });

    // Spec 057, NFR-2 REQ-5
    it('still registers when the keywords request fails, deriving CGI rather than LIVE_ACTION (NFR-2)', async () => {
      redis.get.mockResolvedValue(cachedEntry({ genreIds: [16] }));
      tmdb.keywords.mockRejectedValue(new Error('TMDB unreachable'));

      const result = await service.register(42, 'user-1');

      expect(result).toEqual({ id: 9, type: MEDIA_TYPE.SHOW });
      const [{ data }] = prisma.show.create.mock.calls[0];
      expect(data.contentKind).toBe('CGI');
    });

    it('tops a fully cold cache up with exactly one details() call, never a second one for the same registration (NFR-1)', async () => {
      redis.get.mockResolvedValue(null); // no Redis entry at all
      tmdb.details.mockResolvedValue({
        type: MEDIA_TYPE.SHOW,
        id: 42,
        title: 'Some Series',
        originalTitle: 'Some Series',
        overview: '...',
        posterPath: null,
        backdropPath: '',
        originalLanguage: 'en',
        voteAverage: 8,
        status: 'Ended',
        firstAirDate: '2020-01-01',
        numberOfSeasons: 1,
        numberOfEpisodes: 10,
        seasons: [],
        genreIds: [18], // Drama — not animated
      });

      await service.register(42, 'user-1');

      expect(tmdb.details).toHaveBeenCalledTimes(1);
      const [{ data }] = prisma.show.create.mock.calls[0];
      expect(data.contentKind).toBe('LIVE_ACTION');
    });

    // Spec 088, REQ-7
    it('writes a cold-cache TMDB fallback back to Redis, matching the film path, instead of leaving the series to re-ask TMDB on every registration inside the TTL', async () => {
      redis.get.mockResolvedValue(null); // no Redis entry at all
      tmdb.details.mockResolvedValue({
        type: MEDIA_TYPE.SHOW,
        id: 42,
        title: 'Some Series',
        originalTitle: 'Some Series',
        overview: '...',
        posterPath: null,
        backdropPath: '',
        originalLanguage: 'en',
        voteAverage: 8,
        status: 'Ended',
        firstAirDate: '2020-01-01',
        numberOfSeasons: 1,
        numberOfEpisodes: 10,
        seasons: [],
        genreIds: [18], // Drama — not animated
      });

      await service.register(42, 'user-1');

      expect(pipelineSet).toHaveBeenCalledTimes(1);
      const [cacheKey, cachedJson] = pipelineSet.mock.calls[0];
      expect(cacheKey).toBe('tmdb:show:42');
      expect(JSON.parse(cachedJson)).toMatchObject({
        id: 42,
        title: 'Some Series',
        type: MEDIA_TYPE.SHOW,
      });
    });

    it('never writes the derived contentKind into the shared Redis cache entry (NFR-3)', async () => {
      redis.get.mockResolvedValue(cachedEntry({ genreIds: [16] }));
      tmdb.keywords.mockResolvedValue([210024]);

      await service.register(42, 'user-1');

      expect(pipelineSet).toHaveBeenCalled();
      for (const [, cachedJson] of pipelineSet.mock.calls) {
        const cached = JSON.parse(cachedJson);
        expect(cached).not.toHaveProperty('contentKind');
      }
    });
  });

  describe('hydrate (detached from register)', () => {
    // Spec 006, REQ-13
    const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

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
          {
            id: 1,
            name: 'Season 1',
            seasonNumber: 1,
            episodeCount: 7,
            releaseDate: '2008-01-20',
            overview: '',
            posterPath: '',
          },
          {
            id: 2,
            name: 'Season 2',
            seasonNumber: 2,
            episodeCount: 13,
            releaseDate: '2009-03-08',
            overview: '',
            posterPath: '',
          },
        ],
      };
      tmdb.details.mockResolvedValue(detail);
      prisma.show.create.mockResolvedValue({
        id: 9,
        tmdbId: 42,
        title: 'Breaking Bad',
      });
      prisma.userShow.upsert.mockResolvedValue({ userId: 'user-1', showId: 9 });
      prisma.season.upsert.mockImplementation(
        ({ create }: { create: { seasonNumber: number } }) =>
          Promise.resolve({
            id: create.seasonNumber,
            showId: 9,
            seasonNumber: create.seasonNumber,
          }),
      );
      prisma.episode.upsert.mockResolvedValue({});

      // Spec 006, REQ-14
      tmdb.seasonDetails.mockImplementation(
        (_tmdbId: number, seasonNumber: number) => {
          if (seasonNumber === 2)
            return Promise.reject(new Error('TMDB rate limited'));
          return Promise.resolve([
            {
              id: 1,
              title: 'Pilot',
              overview: '...',
              releaseDate: '2008-01-20',
              episodeNumber: 1,
              stillPath: null,
              voteAverage: 8.9,
            },
          ]);
        },
      );

      const consoleErrorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      await service.register(42, 'user-1');
      // hydrate() is fired but never awaited by register(); give its
      // detached try/catch/finally a couple of microtask flushes to run to
      // completion before asserting on it.
      await flushPromises();
      await flushPromises();

      expect(prisma.season.upsert).toHaveBeenCalledTimes(2); // both seasons' rows were attempted
      expect(prisma.episode.upsert).toHaveBeenCalledTimes(1); // only season 1's single episode was written

      // Spec 006, REQ-14
      expect(prisma.show.update).not.toHaveBeenCalled();

      // Spec 006, NFR-5
      expect(redis.del).toHaveBeenCalledWith('show:hydrate:42');

      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });

  // 074-show-refresh-sweep: the sweep reaches the catalog step only through
  // syncCatalogClaimed. A claim check that never fires lets a nightly sweep
  // and a manual Refresh interleave two season loops on one series, and a
  // stamp written before the season loop finishes makes a half-synced series
  // look complete for 30 or 180 days; both leave a normal-looking response
  // and no error anywhere. A tmdbStatus that is never written leaves every
  // series on the continuing cadence forever.
  describe('syncCatalogClaimed', () => {
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
      genreIds: [],
      seasons: [
        { id: 1, name: 'Season 1', seasonNumber: 1, episodeCount: 1, releaseDate: '2008-01-20', overview: '', posterPath: '' },
        { id: 2, name: 'Season 2', seasonNumber: 2, episodeCount: 1, releaseDate: '2009-03-08', overview: '', posterPath: '' },
      ],
    };
    const episode = {
      id: 1,
      title: 'Pilot',
      overview: '...',
      releaseDate: '2008-01-20',
      episodeNumber: 1,
      stillPath: null,
      voteAverage: 8.9,
    };

    beforeEach(() => {
      redis.del.mockResolvedValue(1);
      prisma.show.update.mockResolvedValue({});
      prisma.season.upsert.mockImplementation(({ create }: { create: { seasonNumber: number } }) =>
        Promise.resolve({ id: create.seasonNumber, showId: 9, seasonNumber: create.seasonNumber }),
      );
      prisma.episode.upsert.mockResolvedValue({});
      redis.pipeline.mockReturnValue({ set: jest.fn(), exec: jest.fn().mockResolvedValue([]) });
    });

    it('writes the TMDB status verbatim onto the row and stamps seasonsSyncedAt after it', async () => {
      redis.set.mockResolvedValue('OK');
      tmdb.details.mockResolvedValue(detail);
      tmdb.seasonDetails.mockResolvedValue([episode]);

      await expect(service.syncCatalogClaimed(9, 42)).resolves.toBe(true);

      const updates = prisma.show.update.mock.calls.map(([arg]) => arg.data);
      expect(updates[0]).toEqual(expect.objectContaining({ tmdbStatus: 'Ended' }));
      expect(updates[1]).toEqual({ seasonsSyncedAt: expect.any(Date) });
      expect(redis.del).toHaveBeenCalledWith('show:hydrate:42');
    });

    it('resolves false and makes no TMDB call when the claim is held, and leaves the held claim alone', async () => {
      redis.set.mockResolvedValue(null);

      await expect(service.syncCatalogClaimed(9, 42)).resolves.toBe(false);

      expect(redis.set).toHaveBeenCalledWith('show:hydrate:42', '1', 'EX', expect.any(Number), 'NX');
      expect(tmdb.details).not.toHaveBeenCalled();
      expect(prisma.show.update).not.toHaveBeenCalled();
      expect(redis.del).not.toHaveBeenCalled();
    });

    it('never stamps seasonsSyncedAt when a season fetch rejects, rethrows, and releases the claim', async () => {
      redis.set.mockResolvedValue('OK');
      tmdb.details.mockResolvedValue(detail);
      tmdb.seasonDetails.mockImplementation((_tmdbId: number, seasonNumber: number) =>
        seasonNumber === 2 ? Promise.reject(new Error('TMDB rate limited')) : Promise.resolve([episode]),
      );

      await expect(service.syncCatalogClaimed(9, 42)).rejects.toThrow('TMDB rate limited');

      const updates = prisma.show.update.mock.calls.map(([arg]) => arg.data);
      expect(updates.some((data) => 'seasonsSyncedAt' in data)).toBe(false);
      expect(redis.del).toHaveBeenCalledWith('show:hydrate:42');
    });
  });
});
