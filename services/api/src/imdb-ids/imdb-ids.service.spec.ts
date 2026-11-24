// This suite exists because otherwise two silent failures slip through: a
// stored "TMDB has no IMDb id" answer being re-fetched on every Subdivx lookup
// (a TMDB request per search, forever, with no error), and a TMDB failure
// throwing out of the detached resolve() that register() starts, which is an
// unhandled rejection no caller can catch.

import { ImdbIdsService } from './imdb-ids.service';
import { PrismaService } from '@/prisma/prisma.service';
import { TmdbClient } from '@/clients/tmdb/client';

describe('ImdbIdsService', () => {
  let prisma: {
    movie: { findUnique: jest.Mock; update: jest.Mock };
    show: { findUnique: jest.Mock; update: jest.Mock };
  };
  let tmdb: { details: jest.Mock };
  let service: ImdbIdsService;

  beforeEach(() => {
    prisma = {
      movie: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      show: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    };
    tmdb = { details: jest.fn() };
    service = new ImdbIdsService(
      prisma as unknown as PrismaService,
      tmdb as unknown as TmdbClient,
    );
  });

  it('never re-fetches a stored "none"', async () => {
    prisma.movie.findUnique.mockResolvedValue({
      tmdbId: 42,
      imdbId: null,
      imdbIdCheckedAt: new Date(),
    });

    await expect(service.resolve('movie', 9)).resolves.toBeNull();

    expect(tmdb.details).not.toHaveBeenCalled();
    expect(prisma.movie.update).not.toHaveBeenCalled();
  });

  it('returns a stored id without a request', async () => {
    prisma.show.findUnique.mockResolvedValue({
      tmdbId: 7,
      imdbId: 'tt5753856',
      imdbIdCheckedAt: new Date(),
    });

    await expect(service.resolve('show', 3)).resolves.toBe('tt5753856');
    expect(tmdb.details).not.toHaveBeenCalled();
  });

  it('records a null answer from TMDB so it is stamped', async () => {
    prisma.movie.findUnique.mockResolvedValue({
      tmdbId: 42,
      imdbId: null,
      imdbIdCheckedAt: null,
    });
    tmdb.details.mockResolvedValue({ imdbId: null });

    await expect(service.resolve('movie', 9)).resolves.toBeNull();

    const data = prisma.movie.update.mock.calls[0][0].data;
    expect(data.imdbId).toBeNull();
    expect(data.imdbIdCheckedAt).toBeInstanceOf(Date);
  });

  it('stamps nothing and does not throw when TMDB fails', async () => {
    prisma.movie.findUnique.mockResolvedValue({
      tmdbId: 42,
      imdbId: null,
      imdbIdCheckedAt: null,
    });
    tmdb.details.mockRejectedValue(new Error('TMDB down'));

    await expect(service.resolve('movie', 9)).resolves.toBeNull();

    expect(prisma.movie.update).not.toHaveBeenCalled();
  });
});
