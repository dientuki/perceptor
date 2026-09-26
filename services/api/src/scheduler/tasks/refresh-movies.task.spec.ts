import { MediaStatus } from '@prisma/client';

import { RefreshMoviesTask } from './refresh-movies.task';
import { PrismaService } from '@/prisma/prisma.service';
import { MoviesService } from '@/movies/movies.service';
import { RefreshCatalogOutcome } from '@/media/entities/title-refresh.entity';

// This suite defends against four ways `refresh_movies` could report a clean
// SUCCESS while quietly doing the wrong thing, none of which would surface
// anywhere else: a selection that includes COMPLETED or catalog-closed films
// silently spends the shared TMDB budget on titles that can no longer change;
// a Promise.all fan-out instead of a sequential walk bursts every film at
// TMDB at once until a shared key gets rate-limited; a FAILED outcome counted
// as processed (or a rejection swallowed) makes a sweep that refreshed nothing
// record SUCCESS in the run history; and a run that throws without the
// failed/total/succeeded counts leaves the operator nothing to act on. Each
// case is written so it fails if the rule it covers is removed.
describe('RefreshMoviesTask', () => {
  let task: RefreshMoviesTask;
  let prisma: { movie: { findMany: jest.Mock } };
  let movies: { refreshCatalog: jest.Mock };

  beforeEach(() => {
    prisma = { movie: { findMany: jest.fn() } };
    movies = { refreshCatalog: jest.fn() };
    task = new RefreshMoviesTask(
      prisma as unknown as PrismaService,
      movies as unknown as MoviesService,
    );
  });

  // The mocked Prisma returns whatever the test says, so only an assertion on
  // the `where` itself notices a selection that grew to include COMPLETED or
  // closed films.
  it('selects only films that are not COMPLETED and whose catalog is not closed', async () => {
    prisma.movie.findMany.mockResolvedValue([]);

    await task.run();

    expect(prisma.movie.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: { not: MediaStatus.COMPLETED }, catalogClosedAt: null },
      }),
    );
  });

  it('makes no refresh calls and reports zero processed for an empty selection', async () => {
    prisma.movie.findMany.mockResolvedValue([]);

    await expect(task.run()).resolves.toEqual({ itemsProcessed: 0 });
    expect(movies.refreshCatalog).not.toHaveBeenCalled();
  });

  it('refreshes films one at a time, never starting the next before the previous resolves', async () => {
    prisma.movie.findMany.mockResolvedValue([
      { id: 1, tmdbId: 101 },
      { id: 2, tmdbId: 102 },
    ]);
    let releaseFirst!: (v: RefreshCatalogOutcome) => void;
    movies.refreshCatalog
      .mockReturnValueOnce(
        new Promise<RefreshCatalogOutcome>((resolve) => {
          releaseFirst = resolve;
        }),
      )
      .mockResolvedValueOnce(RefreshCatalogOutcome.DONE);

    const running = task.run();
    await new Promise((r) => setImmediate(r));

    expect(movies.refreshCatalog).toHaveBeenCalledTimes(1);
    expect(movies.refreshCatalog).toHaveBeenCalledWith(1, 101);

    releaseFirst(RefreshCatalogOutcome.DONE);
    await expect(running).resolves.toEqual({ itemsProcessed: 2 });
    expect(movies.refreshCatalog).toHaveBeenNthCalledWith(2, 2, 102);
  });

  it('returns the success count when every film refreshes', async () => {
    prisma.movie.findMany.mockResolvedValue([
      { id: 1, tmdbId: 101 },
      { id: 2, tmdbId: 102 },
      { id: 3, tmdbId: 103 },
    ]);
    movies.refreshCatalog.mockResolvedValue(RefreshCatalogOutcome.DONE);

    await expect(task.run()).resolves.toEqual({ itemsProcessed: 3 });
  });

  it('throws naming failed, total and succeeded when a film returns FAILED, after still trying the rest', async () => {
    prisma.movie.findMany.mockResolvedValue([
      { id: 1, tmdbId: 101 },
      { id: 2, tmdbId: 102 },
      { id: 3, tmdbId: 103 },
    ]);
    movies.refreshCatalog
      .mockResolvedValueOnce(RefreshCatalogOutcome.FAILED)
      .mockResolvedValueOnce(RefreshCatalogOutcome.DONE)
      .mockResolvedValueOnce(RefreshCatalogOutcome.DONE);

    await expect(task.run()).rejects.toThrow(
      'refresh_movies: 1 of 3 film(s) failed; 2 refreshed successfully',
    );
    expect(movies.refreshCatalog).toHaveBeenCalledTimes(3);
  });

  it('counts a rejected refresh as failed and does not abort the films after it', async () => {
    prisma.movie.findMany.mockResolvedValue([
      { id: 1, tmdbId: 101 },
      { id: 2, tmdbId: 102 },
    ]);
    movies.refreshCatalog
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(RefreshCatalogOutcome.DONE);

    await expect(task.run()).rejects.toThrow(
      'refresh_movies: 1 of 2 film(s) failed; 1 refreshed successfully',
    );
    expect(movies.refreshCatalog).toHaveBeenCalledTimes(2);
  });
});
