import { Test, TestingModule } from '@nestjs/testing';
import { HttpException } from '@nestjs/common';
import { MoviesService } from './movies.service';
import { PrismaService } from '@/prisma/prisma.service';
import { RedisService } from '@/redis/redis.service';
import { TmdbClient, posterUrl } from '@/clients/tmdb/client';
import { QbittorrentClient } from '@/clients/torrent/client';
import { MediaServerReconcileService } from '@/media-server/media-server-reconcile.service';
import { MediaCapabilitiesService } from '@/media/media-capabilities.service';
import { MEDIA_TYPE } from '@/types/media';
import { ERROR_KEYS } from '@/i18n/error-keys';

// A magnet with a valid infoHash, reused across the attachTorrentSource
// cases below — parseMagnet() is the real implementation, not mocked.
const MAGNET =
  'magnet:?xt=urn:btih:5d4a2f1c8e3b9a7d6c5e4f3a2b1c0d9e8f7a6b5c&dn=Test';

// This suite exists because 005-movie-search's four riskiest paths all fail
// with a perfectly successful response and nothing to notice:
//
//  - a reordering that enriches search results with this caller's ownership
//    before writing them to Redis leaks one user's `inLibrary`/`movieId`
//    into a cache key shared by every user who searches the same film for
//    the next 24 hours — the return value of searchMovies() looks identical
//    either way, so only asserting on what is actually handed to the Redis
//    pipeline can catch it;
//  - a `movies` query that drops (or never had) its `user_movies` filter
//    returns every user's films instead of the caller's — REQ-4, and the
//    exact class of bug Article IX exists for;
//  - `addMovie` on a film someone else already registered either creates a
//    second `Movie` row (a second, redundant download of the same film) or
//    throws a raw Prisma P2002 the second time the same user clicks it;
//  - a broken TMDB-fallback mapping registers a film with the wrong poster
//    size or a relative path Next/`<img>` cannot render, with no exception
//    anywhere in the chain;
//  - `findOneFromDb` dropping (or never applying) its `user_movies` scope
//    would resolve a film for any authenticated caller, not just the one
//    linked to it — the query still succeeds, `movie(id)` still returns a
//    real record with a real poster, and the page renders correctly; the
//    only wrong thing is whose library it came from (008-movie-detail);
//  - `register`'s runtime-derived `isShort` (056-shorts-runtime-classification)
//    silently misclassifying a film costs nothing visible either: the film
//    registers fine either way, it just files under the wrong category
//    forever (048 guarantees nothing ever moves it back), or pays a TMDB
//    call it should never have made when shorts are disabled.
describe('MoviesService', () => {
  let service: MoviesService;
  let prisma: {
    movie: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    userMovie: {
      upsert: jest.Mock;
    };
    mediaSource: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };
  let redis: {
    get: jest.Mock;
    pipeline: jest.Mock;
  };
  let tmdb: {
    search: jest.Mock;
    details: jest.Mock;
    keywords: jest.Mock;
  };
  let qbittorrent: {
    add: jest.Mock;
  };
  let mediaServerReconcile: {
    reconcileMovie: jest.Mock;
  };
  let mediaCapabilities: {
    isShortsEnabled: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      movie: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      userMovie: {
        upsert: jest.fn(),
      },
      mediaSource: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    redis = {
      get: jest.fn(),
      pipeline: jest.fn(),
    };
    tmdb = {
      search: jest.fn(),
      details: jest.fn(),
      keywords: jest.fn(),
    };
    qbittorrent = {
      add: jest.fn(),
    };
    mediaServerReconcile = {
      reconcileMovie: jest.fn().mockResolvedValue(undefined),
    };
    mediaCapabilities = {
      isShortsEnabled: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MoviesService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
        { provide: TmdbClient, useValue: tmdb },
        { provide: QbittorrentClient, useValue: qbittorrent },
        {
          provide: MediaServerReconcileService,
          useValue: mediaServerReconcile,
        },
        { provide: MediaCapabilitiesService, useValue: mediaCapabilities },
      ],
    }).compile();

    service = module.get<MoviesService>(MoviesService);
  });

  describe('search', () => {
    it("hands Redis a catalog-only object, never this caller's ownership", async () => {
      tmdb.search.mockResolvedValue([
        {
          id: 42,
          title: 'Dune',
          release_date: '2021-10-21',
          poster_path: '/dune.jpg',
          original_language: 'en',
          overview: 'Sand.',
        },
      ]);
      // Someone else already registered this film too, so enrichWithOwnership
      // has real, non-default values to smuggle into the cache if the
      // ordering were ever broken.
      // isShort: true here too, so a leak into the cached shape would show
      // up as a non-default value rather than accidentally matching the
      // false default (048-shorts-category).
      prisma.movie.findMany.mockResolvedValue([
        { id: 7, tmdbId: 42, isShort: true, users: [{ userId: 'user-1' }] },
      ]);
      const pipelineSet = jest.fn().mockReturnThis();
      const pipelineExec = jest.fn().mockResolvedValue([[null, 'OK']]);
      redis.pipeline.mockReturnValue({ set: pipelineSet, exec: pipelineExec });

      const results = await service.search('dune', 'user-1');

      // Sanity check: the returned value is correctly enriched either way —
      // this is exactly why the assertion below has to look at the Redis
      // call, not at this.
      expect(results).toEqual([
        expect.objectContaining({
          id: 42,
          mediaId: 7,
          inLibrary: true,
          isShort: true,
        }),
      ]);

      expect(pipelineSet).toHaveBeenCalledTimes(1);
      const [cacheKey, cachedJson] = pipelineSet.mock.calls[0];
      expect(cacheKey).toBe('tmdb:movie:42');
      const cached = JSON.parse(cachedJson);
      expect(cached).not.toHaveProperty('movieId');
      expect(cached).not.toHaveProperty('inLibrary');
      expect(cached).not.toHaveProperty('isShort');
      expect(cached).toEqual({
        id: 42,
        title: 'Dune',
        releaseDate: '2021-10-21',
        posterUrl: posterUrl('/dune.jpg'),
        originalLanguage: 'en',
        overview: 'Sand.',
        type: MEDIA_TYPE.MOVIE,
      });
    });
  });

  describe('findAll', () => {
    it('scopes the query to the caller through the user_movies join', async () => {
      prisma.movie.findMany.mockResolvedValue([
        { id: 1, title: 'Mine', status: 'MISSING', mediaSources: [], processJobs: [] },
      ]);

      await service.findAll('user-1');

      // The failure mode here is a query that silently returns everyone's
      // films: asserting the where-clause is the only way a mocked Prisma
      // can catch it, since the mock returns whatever we told it to
      // regardless of what it was actually asked for.
      expect(prisma.movie.findMany).toHaveBeenCalledWith({
        where: { users: { some: { userId: 'user-1' } } },
        orderBy: { createdAt: 'desc' },
        include: { mediaSources: true, processJobs: true },
      });
    });

    // 048-shorts-category REQ-8: the where clause must only carry `isShort`
    // when the resolver was actually given the argument — a version that
    // always adds `isShort: undefined` looks the same to Prisma today but
    // would silently break the moment someone tightens the mock, and a
    // version that defaults to `false` would wrongly exclude every short
    // from the unfiltered `/movies` listing (REQ-11).
    it('adds isShort to the where clause only when the argument is given', async () => {
      prisma.movie.findMany.mockResolvedValue([]);

      await service.findAll('user-1', true);

      expect(prisma.movie.findMany).toHaveBeenCalledWith({
        where: { users: { some: { userId: 'user-1' } }, isShort: true },
        orderBy: { createdAt: 'desc' },
        include: { mediaSources: true, processJobs: true },
      });
    });

    it('filters for isShort: false as a real filter, not a falsy no-op', async () => {
      prisma.movie.findMany.mockResolvedValue([]);

      await service.findAll('user-1', false);

      expect(prisma.movie.findMany).toHaveBeenCalledWith({
        where: { users: { some: { userId: 'user-1' } }, isShort: false },
        orderBy: { createdAt: 'desc' },
        include: { mediaSources: true, processJobs: true },
      });
    });

    it('omits isShort from the where clause when the argument is undefined', async () => {
      prisma.movie.findMany.mockResolvedValue([]);

      await service.findAll('user-1', undefined);

      expect(prisma.movie.findMany).toHaveBeenCalledWith({
        where: { users: { some: { userId: 'user-1' } } },
        orderBy: { createdAt: 'desc' },
        include: { mediaSources: true, processJobs: true },
      });
    });
  });

  describe('findOneFromDb', () => {
    it('scopes the query to the caller through the user_movies join', async () => {
      prisma.movie.findFirst.mockResolvedValue({
        id: 7,
        title: 'Mine',
        status: 'MISSING',
        mediaSources: [],
        processJobs: [],
      });

      await service.findOneFromDb(7, 'user-1');

      // The failure mode here is a query that resolves a film for any
      // authenticated caller, not just the one linked to it: asserting the
      // where-clause is the only way a mocked Prisma can catch it, since the
      // mock returns whatever we told it to regardless of what it was
      // actually asked for. A version that keeps `where: { id }` and moves
      // the join into `include` would pass a looser, `objectContaining`
      // assertion while being entirely unscoped — hence full equality.
      expect(prisma.movie.findFirst).toHaveBeenCalledTimes(1);
      const [args] = prisma.movie.findFirst.mock.calls[0];
      expect(args.where).toEqual({
        id: 7,
        users: { some: { userId: 'user-1' } },
      });
    });

    it('returns null for a film the caller is not linked to', async () => {
      prisma.movie.findFirst.mockResolvedValue(null);

      await expect(service.findOneFromDb(7, 'user-2')).resolves.toBeNull();
    });

    it('returns the same null for an id that does not exist', async () => {
      // REQ-3: an unowned film and a missing one must be indistinguishable
      // from the caller's side — both resolve through the identical query
      // shape above and both come back null.
      prisma.movie.findFirst.mockResolvedValue(null);

      await expect(
        service.findOneFromDb(999999999, 'user-1'),
      ).resolves.toBeNull();
    });
  });

  describe('setShort', () => {
    it('flips isShort on an owned film and returns it through withDerivedStatus', async () => {
      prisma.movie.findFirst.mockResolvedValue({
        id: 7,
        title: 'Mine',
        status: 'MISSING',
        mediaSources: [],
        processJobs: [],
      });
      prisma.movie.update.mockResolvedValue({
        id: 7,
        title: 'Mine',
        status: 'MISSING',
        isShort: true,
        mediaSources: [],
        processJobs: [],
      });

      const result = await service.setShort(7, 'user-1', true);

      expect(prisma.movie.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: { isShort: true },
        include: { mediaSources: true, processJobs: true },
      });
      // The derived-status wrapper must run on the update's result, not just
      // findOneFromDb's read — otherwise the mutation's `status` field would
      // reflect the row's state before the flip rather than after it.
      expect(result.status).toBe('MISSING');
      expect((result as { isShort: boolean }).isShort).toBe(true);
    });

    it('refuses a film the caller does not own without writing anything', async () => {
      // findOneFromDb's ownership scope returns null both for a missing id
      // and for another user's film (already covered above) — setShort must
      // never reach `movie.update` in either case, or a caller who cannot
      // even read the row could still flip its flag.
      prisma.movie.findFirst.mockResolvedValue(null);

      await expect(service.setShort(7, 'user-2', true)).rejects.toMatchObject({
        response: { i18n: { key: ERROR_KEYS.MOVIE_NOT_FOUND } },
      });
      expect(prisma.movie.update).not.toHaveBeenCalled();
    });
  });

  describe('register', () => {
    it('links the caller to an already-registered film, creates no second row, and tolerates a repeat', async () => {
      const existing = { id: 5, tmdbId: 42, title: 'Dune' };
      prisma.movie.findUnique.mockResolvedValue(existing);
      prisma.userMovie.upsert.mockResolvedValue({
        userId: 'user-1',
        movieId: 5,
      });

      const first = await service.register(42, 'user-1');
      const second = await service.register(42, 'user-1');

      expect(first).toEqual({ id: 5, type: MEDIA_TYPE.MOVIE });
      expect(second).toEqual({ id: 5, type: MEDIA_TYPE.MOVIE });
      expect(prisma.movie.create).not.toHaveBeenCalled();
      expect(prisma.userMovie.upsert).toHaveBeenCalledTimes(2);
      expect(prisma.userMovie.upsert).toHaveBeenNthCalledWith(1, {
        where: { userId_movieId: { userId: 'user-1', movieId: 5 } },
        update: {},
        create: { userId: 'user-1', movieId: 5 },
      });
      expect(prisma.userMovie.upsert).toHaveBeenNthCalledWith(2, {
        where: { userId_movieId: { userId: 'user-1', movieId: 5 } },
        update: {},
        create: { userId: 'user-1', movieId: 5 },
      });
    });

    // REQ-7: a derivation that overrode a user's manual reclassification on
    // every other user's add would be silent — the film simply flips back
    // and forth depending on who registers it last.
    it('never reaches deriveIsShort for an already-registered film', async () => {
      const existing = { id: 5, tmdbId: 42, title: 'Dune' };
      prisma.movie.findUnique.mockResolvedValue(existing);
      prisma.userMovie.upsert.mockResolvedValue({
        userId: 'user-1',
        movieId: 5,
      });

      await service.register(42, 'user-1');

      expect(mediaCapabilities.isShortsEnabled).not.toHaveBeenCalled();
      expect(tmdb.details).not.toHaveBeenCalled();
      expect(prisma.movie.update).not.toHaveBeenCalled();
    });
  });

  // 056-shorts-runtime-classification: the initial value for a newly
  // registered film's isShort, derived from the runtime TMDB reports. Each
  // case here is owed because the failure is otherwise invisible —
  // registration always succeeds; only the stored flag (and therefore which
  // folder the file ends up in, forever — 048 never moves it back) is wrong.
  describe('register (short classification)', () => {
    // genreIds defaults to a non-animated, already-known list: 057 added a
    // second catalog fact (`genreIds`) to the same top-up `isShort` shares,
    // so a case here that only cares about runtime must supply it too, or an
    // incidental top-up call (made for contentKind's sake) muddies what the
    // case is actually asserting. Pass `undefined` explicitly to simulate a
    // cache entry that is missing it (forcing the shared top-up).
    function warmCacheEntry(
      runtime?: number | null,
      genreIds: number[] | undefined = [35],
    ): void {
      const entry: Record<string, unknown> = {
        id: 42,
        title: 'Dune',
        releaseDate: '2021-10-21',
        posterUrl: null,
        originalLanguage: 'en',
        overview: 'Sand.',
        type: MEDIA_TYPE.MOVIE,
      };
      if (runtime !== undefined) entry.runtime = runtime;
      if (genreIds !== undefined) entry.genreIds = genreIds;
      redis.get.mockResolvedValue(JSON.stringify(entry));
    }

    beforeEach(() => {
      prisma.movie.findUnique.mockResolvedValue(null); // not registered yet
      prisma.movie.create.mockResolvedValue({ id: 9, tmdbId: 42, title: 'Dune' });
      prisma.userMovie.upsert.mockResolvedValue({ userId: 'user-1', movieId: 9 });
      const pipelineSet = jest.fn().mockReturnThis();
      const pipelineExec = jest.fn().mockResolvedValue([[null, 'OK']]);
      redis.pipeline.mockReturnValue({ set: pipelineSet, exec: pipelineExec });
    });

    it('registers a runtime strictly under 40 minutes as a short', async () => {
      warmCacheEntry(39);

      await service.register(42, 'user-1');

      expect(prisma.movie.create.mock.calls[0][0].data.isShort).toBe(true);
    });

    // The boundary itself: an off-by-one here files a feature film under
    // path_shorts forever, with nothing failing anywhere.
    it('registers a runtime of exactly 40 minutes as not a short', async () => {
      warmCacheEntry(40);

      await service.register(42, 'user-1');

      expect(prisma.movie.create.mock.calls[0][0].data.isShort).toBe(false);
    });

    it.each([
      ['a runtime of 0', 0],
      ['a null runtime', null],
      ['an absent runtime', undefined],
    ])('registers %s as not a short', async (_label, runtime) => {
      warmCacheEntry(runtime as number | null | undefined);

      await service.register(42, 'user-1');

      expect(prisma.movie.create.mock.calls[0][0].data.isShort).toBe(false);
    });

    // 057 unbundled the top-up from the shorts capability: it is now shared
    // with content-kind classification and fires whenever either catalog
    // fact is missing, regardless of whether shorts are enabled. A fully
    // warm entry (both facts already cached) is the only case that still
    // skips the call outright.
    it('registers as not a short and skips the TMDB call entirely when shorts are disabled and the cache is already warm', async () => {
      mediaCapabilities.isShortsEnabled.mockResolvedValue(false);
      warmCacheEntry(148, [35]);

      await service.register(42, 'user-1');

      expect(prisma.movie.create.mock.calls[0][0].data.isShort).toBe(false);
      expect(tmdb.details).not.toHaveBeenCalled();
    });

    it('tops up a warm cache entry with no runtime via exactly one tmdb.details call, and writes the result back', async () => {
      warmCacheEntry(undefined);
      tmdb.details.mockResolvedValue({
        type: MEDIA_TYPE.MOVIE,
        id: 42,
        runtime: 25,
      });
      const pipelineSet = jest.fn().mockReturnThis();
      const pipelineExec = jest.fn().mockResolvedValue([[null, 'OK']]);
      redis.pipeline.mockReturnValue({ set: pipelineSet, exec: pipelineExec });

      await service.register(42, 'user-1');

      expect(tmdb.details).toHaveBeenCalledTimes(1);
      expect(prisma.movie.create.mock.calls[0][0].data.isShort).toBe(true);
      expect(pipelineSet).toHaveBeenCalledTimes(1);
      const [, cachedJson] = pipelineSet.mock.calls[0];
      expect(JSON.parse(cachedJson)).toMatchObject({ id: 42, runtime: 25 });
    });

    it('never calls tmdb.details when the cached runtime is already a number', async () => {
      warmCacheEntry(148);

      await service.register(42, 'user-1');

      expect(tmdb.details).not.toHaveBeenCalled();
      expect(prisma.movie.create.mock.calls[0][0].data.isShort).toBe(false);
    });

    // NFR-2 plus the cache-poisoning guard: a registration must never fail
    // over a decoration, and a transient failure must never be written back
    // — that would pin "not a short" for the film for the full 24h TTL.
    it('still registers the film as not a short, writing nothing to Redis, when the top-up rejects', async () => {
      warmCacheEntry(undefined);
      tmdb.details.mockRejectedValue(new Error('TMDB unreachable'));
      const pipelineSet = jest.fn().mockReturnThis();
      const pipelineExec = jest.fn().mockResolvedValue([[null, 'OK']]);
      redis.pipeline.mockReturnValue({ set: pipelineSet, exec: pipelineExec });

      await expect(service.register(42, 'user-1')).resolves.toEqual({
        id: 9,
        type: MEDIA_TYPE.MOVIE,
      });

      expect(prisma.movie.create.mock.calls[0][0].data.isShort).toBe(false);
      expect(pipelineSet).not.toHaveBeenCalled();
    });
  });

  // 057-content-kind-classification: three distinct silent failures — a
  // registration always succeeds either way, so nothing but the stored
  // `contentKind` (and, for (a), a doubled TMDB bill) shows the mistake.
  describe('register (content kind classification)', () => {
    function baseEntry(
      overrides: Record<string, unknown> = {},
    ): Record<string, unknown> {
      return {
        id: 42,
        title: 'Dune',
        releaseDate: '2021-10-21',
        posterUrl: null,
        originalLanguage: 'en',
        overview: 'Sand.',
        type: MEDIA_TYPE.MOVIE,
        runtime: 155, // present so isShort's own top-up never interferes here
        ...overrides,
      };
    }

    beforeEach(() => {
      prisma.movie.findUnique.mockResolvedValue(null); // not registered yet
      prisma.movie.create.mockResolvedValue({ id: 9, tmdbId: 42, title: 'Dune' });
      prisma.userMovie.upsert.mockResolvedValue({ userId: 'user-1', movieId: 9 });
      const pipelineSet = jest.fn().mockReturnThis();
      const pipelineExec = jest.fn().mockResolvedValue([[null, 'OK']]);
      redis.pipeline.mockReturnValue({ set: pipelineSet, exec: pipelineExec });
    });

    // (a) A cache entry missing both `runtime` and `genreIds` must cost
    // exactly one `tmdb.details` call: the same shared top-up serves
    // `isShort` and `contentKind`. A second, independent call is free of any
    // error and simply doubles TMDB cost per cold registration — the exact
    // regression plan.md's § Risks names first. `toHaveBeenCalledTimes(1)`
    // fails immediately if a second, separate top-up call is ever added.
    it('tops up a cache entry missing both runtime and genreIds via exactly one tmdb.details call', async () => {
      redis.get.mockResolvedValue(
        JSON.stringify(baseEntry({ runtime: undefined })),
      );
      tmdb.details.mockResolvedValue({
        type: MEDIA_TYPE.MOVIE,
        id: 42,
        runtime: 155,
        genreIds: [18],
      });

      await service.register(42, 'user-1');

      expect(tmdb.details).toHaveBeenCalledTimes(1);
      expect(prisma.movie.create.mock.calls[0][0].data.contentKind).toBe(
        'LIVE_ACTION',
      );
    });

    // (b) NFR-2, first case: the genres could not be established at all
    // (details() itself failed) — the film still registers, as LIVE_ACTION.
    it('still registers the film, as LIVE_ACTION, when the genre top-up rejects', async () => {
      redis.get.mockResolvedValue(
        JSON.stringify(baseEntry({ runtime: undefined, genreIds: undefined })),
      );
      tmdb.details.mockRejectedValue(new Error('TMDB unreachable'));

      await expect(service.register(42, 'user-1')).resolves.toEqual({
        id: 9,
        type: MEDIA_TYPE.MOVIE,
      });
      expect(prisma.movie.create.mock.calls[0][0].data.contentKind).toBe(
        'LIVE_ACTION',
      );
    });

    // (b) NFR-2, second case: the genres say animated but the keywords call
    // fails — the film still registers, as CGI (REQ-5's fallback).
    it('still registers the film, as CGI, when an animated title\'s keywords call rejects', async () => {
      redis.get.mockResolvedValue(
        JSON.stringify(baseEntry({ genreIds: [16] })), // 16 = Animation
      );
      tmdb.keywords.mockRejectedValue(new Error('TMDB unreachable'));

      await expect(service.register(42, 'user-1')).resolves.toEqual({
        id: 9,
        type: MEDIA_TYPE.MOVIE,
      });
      expect(prisma.movie.create.mock.calls[0][0].data.contentKind).toBe(
        'CGI',
      );
      expect(tmdb.details).not.toHaveBeenCalled(); // genreIds was already warm
    });

    // (c) The derived `contentKind` must never enter the shared Redis entry
    // — that cache is read by every user and every installation, and the
    // flag is a per-title one. Provoke the write this feature actually adds
    // (the keywords top-up) and inspect exactly what reaches `pipeline.set`.
    it('never hands cacheMovies an object carrying contentKind', async () => {
      redis.get.mockResolvedValue(
        JSON.stringify(baseEntry({ genreIds: [16] })), // animated -> keywords fetched
      );
      tmdb.keywords.mockResolvedValue([210024]); // anime

      await service.register(42, 'user-1');

      const pipelineSet = redis.pipeline.mock.results[0].value.set as jest.Mock;
      expect(pipelineSet).toHaveBeenCalled();
      for (const [, cachedJson] of pipelineSet.mock.calls) {
        expect(JSON.parse(cachedJson)).not.toHaveProperty('contentKind');
      }
    });
  });

  describe('TMDB fallback (cold Redis cache)', () => {
    it('maps MovieDetail.posterPath to the same absolute posterUrl the search path uses', async () => {
      prisma.movie.findUnique.mockResolvedValue(null); // not registered yet
      redis.get.mockResolvedValue(null); // expired/evicted — REQ-2
      // getCachedMovie's cold branch now writes the fetched object back
      // through cacheMovies() (REQ-6) — give the pipeline mock a shape to
      // write into rather than letting it throw into cacheMovies' own catch.
      const pipelineSet = jest.fn().mockReturnThis();
      const pipelineExec = jest.fn().mockResolvedValue([[null, 'OK']]);
      redis.pipeline.mockReturnValue({ set: pipelineSet, exec: pipelineExec });
      tmdb.details.mockResolvedValue({
        type: MEDIA_TYPE.MOVIE,
        id: 42,
        title: 'Dune',
        originalTitle: 'Dune',
        overview: 'Sand.',
        posterPath: '/dune.jpg',
        backdropPath: '/dune-backdrop.jpg',
        originalLanguage: 'en',
        voteAverage: 8.1,
        releaseDate: '2021-10-21',
        runtime: 155,
        status: 'Released',
      });
      prisma.movie.create.mockResolvedValue({
        id: 9,
        tmdbId: 42,
        title: 'Dune',
      });
      prisma.userMovie.upsert.mockResolvedValue({
        userId: 'user-1',
        movieId: 9,
      });

      await service.register(42, 'user-1');

      expect(prisma.movie.create).toHaveBeenCalledTimes(1);
      const createData = prisma.movie.create.mock.calls[0][0].data;
      // Same helper, same size the warm-cache path in searchMovies uses —
      // a divergence here yields a registered film with a broken or
      // mismatched poster and no exception anywhere.
      expect(createData.posterUrl).toBe(posterUrl('/dune.jpg'));
      expect(createData.posterUrl).toBe(
        'https://image.tmdb.org/t/p/w300/dune.jpg',
      );
    });
  });

  // This suite exists because two different bugs are both silent: a
  // `COMPLETED` film answering the wrong key would show the mild "a
  // download is already running" copy to someone about to destroy a
  // finished file with nothing failing anywhere (022-download-status-tags
  // REQ-7 retired that key, so today the only wrong answer left is raising
  // no error at all); and a merely-downloading film that still conflicts
  // would silently defeat REQ-6's "several active sources at once".
  describe('addMagnetToMovie (attachTorrentSource conflict key)', () => {
    function expectI18nKey(
      promise: Promise<unknown>,
      key: string,
    ): Promise<void> {
      return promise.then(
        () => {
          throw new Error('expected the call to reject');
        },
        (error) => {
          expect(error).toBeInstanceOf(HttpException);
          const response = (error as HttpException).getResponse() as {
            i18n?: { key: string };
          };
          expect(response.i18n?.key).toBe(key);
        },
      );
    }

    it('answers error.movie.already_completed for a COMPLETED film with no force', async () => {
      prisma.movie.findFirst.mockResolvedValue({
        id: 7,
        mediaSources: [{ id: 99 }],
        status: 'COMPLETED',
      });

      await expectI18nKey(
        service.addMagnetToMovie(7, { magnet: MAGNET, force: false }, 'user-1'),
        ERROR_KEYS.MOVIE_ALREADY_COMPLETED,
      );
    });

    // REQ-7: the guard's trigger changed from "has a source" to "is
    // COMPLETED" — a second acquisition against a merely-downloading film
    // must succeed with no conflict at all, no confirmation and no error.
    // Re-introducing the old "has a source" condition would make this
    // reject again with no other test catching it.
    it('no longer conflicts for a merely-busy film without force', async () => {
      prisma.movie.findFirst.mockResolvedValue({
        id: 7,
        title: 'Transformers',
        mediaSources: [{ id: 99 }],
        status: 'DOWNLOADING',
      });
      prisma.mediaSource.findUnique.mockResolvedValue(null);
      qbittorrent.add.mockResolvedValue('/media/downloads/abc123');
      prisma.mediaSource.create.mockResolvedValue({ id: 100 });
      prisma.movie.update.mockResolvedValue({ id: 7, status: 'DOWNLOADING' });

      await expect(
        service.addMagnetToMovie(7, { magnet: MAGNET, force: false }, 'user-1'),
      ).resolves.toEqual({ id: 7, status: 'DOWNLOADING' });

      expect(qbittorrent.add).toHaveBeenCalled();
      expect(prisma.mediaSource.create).toHaveBeenCalled();
    });
  });
});
