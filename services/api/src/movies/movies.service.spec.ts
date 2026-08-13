import { Test, TestingModule } from '@nestjs/testing';
import { MoviesService } from './movies.service';
import { PrismaService } from '@/prisma/prisma.service';
import { RedisService } from '@/redis/redis.service';
import { TmdbClient, posterUrl } from '@/clients/tmdb/client';
import { QbittorrentClient } from '@/clients/torrent/client';
import { MEDIA_TYPE } from '@/types/media';

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
//    only wrong thing is whose library it came from (008-movie-detail).
describe('MoviesService', () => {
  let service: MoviesService;
  let prisma: {
    movie: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
    };
    userMovie: {
      upsert: jest.Mock;
    };
  };
  let redis: {
    get: jest.Mock;
    pipeline: jest.Mock;
  };
  let tmdb: {
    search: jest.Mock;
    details: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      movie: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      userMovie: {
        upsert: jest.fn(),
      },
    };
    redis = {
      get: jest.fn(),
      pipeline: jest.fn(),
    };
    tmdb = {
      search: jest.fn(),
      details: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MoviesService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
        { provide: TmdbClient, useValue: tmdb },
        { provide: QbittorrentClient, useValue: {} },
      ],
    }).compile();

    service = module.get<MoviesService>(MoviesService);
  });

  describe('search', () => {
    it('hands Redis a catalog-only object, never this caller\'s ownership', async () => {
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
      prisma.movie.findMany.mockResolvedValue([
        { id: 7, tmdbId: 42, users: [{ userId: 'user-1' }] },
      ]);
      const pipelineSet = jest.fn().mockReturnThis();
      const pipelineExec = jest.fn().mockResolvedValue([[null, 'OK']]);
      redis.pipeline.mockReturnValue({ set: pipelineSet, exec: pipelineExec });

      const results = await service.search('dune', 'user-1');

      // Sanity check: the returned value is correctly enriched either way —
      // this is exactly why the assertion below has to look at the Redis
      // call, not at this.
      expect(results).toEqual([
        expect.objectContaining({ id: 42, mediaId: 7, inLibrary: true }),
      ]);

      expect(pipelineSet).toHaveBeenCalledTimes(1);
      const [cacheKey, cachedJson] = pipelineSet.mock.calls[0];
      expect(cacheKey).toBe('tmdb:movie:42');
      const cached = JSON.parse(cachedJson);
      expect(cached).not.toHaveProperty('movieId');
      expect(cached).not.toHaveProperty('inLibrary');
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
      prisma.movie.findMany.mockResolvedValue([{ id: 1, title: 'Mine' }]);

      await service.findAll('user-1');

      // The failure mode here is a query that silently returns everyone's
      // films: asserting the where-clause is the only way a mocked Prisma
      // can catch it, since the mock returns whatever we told it to
      // regardless of what it was actually asked for.
      expect(prisma.movie.findMany).toHaveBeenCalledWith({
        where: { users: { some: { userId: 'user-1' } } },
        orderBy: { createdAt: 'desc' },
        include: { mediaSource: true, processJobs: true },
      });
    });
  });

  describe('findOneFromDb', () => {
    it('scopes the query to the caller through the user_movies join', async () => {
      prisma.movie.findFirst.mockResolvedValue({ id: 7, title: 'Mine' });

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
      expect(args.where).toEqual({ id: 7, users: { some: { userId: 'user-1' } } });
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

      await expect(service.findOneFromDb(999999999, 'user-1')).resolves.toBeNull();
    });
  });

  describe('register', () => {
    it('links the caller to an already-registered film, creates no second row, and tolerates a repeat', async () => {
      const existing = { id: 5, tmdbId: 42, title: 'Dune' };
      prisma.movie.findUnique.mockResolvedValue(existing);
      prisma.userMovie.upsert.mockResolvedValue({ userId: 'user-1', movieId: 5 });

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
  });

  describe('TMDB fallback (cold Redis cache)', () => {
    it('maps MovieDetail.posterPath to the same absolute posterUrl the search path uses', async () => {
      prisma.movie.findUnique.mockResolvedValue(null); // not registered yet
      redis.get.mockResolvedValue(null); // expired/evicted — REQ-2
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
      prisma.movie.create.mockResolvedValue({ id: 9, tmdbId: 42, title: 'Dune' });
      prisma.userMovie.upsert.mockResolvedValue({ userId: 'user-1', movieId: 9 });

      await service.register(42, 'user-1');

      expect(prisma.movie.create).toHaveBeenCalledTimes(1);
      const createData = prisma.movie.create.mock.calls[0][0].data;
      // Same helper, same size the warm-cache path in searchMovies uses —
      // a divergence here yields a registered film with a broken or
      // mismatched poster and no exception anywhere.
      expect(createData.posterUrl).toBe(posterUrl('/dune.jpg'));
      expect(createData.posterUrl).toBe('https://image.tmdb.org/t/p/w300/dune.jpg');
    });
  });
});
