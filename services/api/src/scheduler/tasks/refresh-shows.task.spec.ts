import { RefreshShowsTask } from './refresh-shows.task';
import { PrismaService } from '@/prisma/prisma.service';
import { ShowsService } from '@/shows/shows.service';

// This suite defends against ways `refresh_shows` could report a clean
// SUCCESS while quietly refreshing the wrong set of series, with nothing
// anywhere noticing a series that stopped being refreshed: a continuing
// branch written as `notIn` alone evaluates to NULL for every series with no
// stored status, so exactly the pre-migration library is skipped forever; a
// cadence cutoff off by a unit or a comparison either re-reads every series
// on every tick or never selects any; an unrecognised status routed onto the
// ended window hides a revival for six months; a series that throws, if not
// contained, aborts every series after it or is reported as a success; and a
// held claim counted as a failure or a write misreports the run. The prisma
// mock returns whatever it is told, so selection is asserted on the generated
// `where`, computed independently against a frozen clock.
describe('RefreshShowsTask', () => {
  const NOW = new Date('2026-09-26T12:00:00.000Z');
  const DAY_MS = 24 * 60 * 60 * 1000;

  let task: RefreshShowsTask;
  let prisma: { show: { findMany: jest.Mock } };
  let shows: { syncCatalogClaimed: jest.Mock };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    prisma = { show: { findMany: jest.fn().mockResolvedValue([]) } };
    shows = { syncCatalogClaimed: jest.fn().mockResolvedValue(true) };
    task = new RefreshShowsTask(
      prisma as unknown as PrismaService,
      shows as unknown as ShowsService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('selection (REQ-2, REQ-3, REQ-4)', () => {
    it('selects never-synced, ended past 180 days, and everything else past 30 days, with an explicit NULL-status arm', async () => {
      await task.run();

      const endedCutoff = new Date(NOW.getTime() - 180 * DAY_MS);
      const continuingCutoff = new Date(NOW.getTime() - 30 * DAY_MS);
      expect(prisma.show.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { seasonsSyncedAt: null },
              {
                tmdbStatus: { in: ['Ended', 'Canceled'] },
                seasonsSyncedAt: { lt: endedCutoff },
              },
              {
                OR: [{ tmdbStatus: null }, { tmdbStatus: { notIn: ['Ended', 'Canceled'] } }],
                seasonsSyncedAt: { lt: continuingCutoff },
              },
            ],
          },
        }),
      );
    });

    it('puts the ended cutoff at 180 days and the continuing cutoff at 30, so 100 and 200 days, 20 and 40 days fall on the intended sides', async () => {
      await task.run();

      const where = prisma.show.findMany.mock.calls[0][0].where;
      const endedCutoff: Date = where.OR[1].seasonsSyncedAt.lt;
      const continuingCutoff: Date = where.OR[2].seasonsSyncedAt.lt;
      const ago = (days: number) => new Date(NOW.getTime() - days * DAY_MS);

      expect(ago(100) < endedCutoff).toBe(false);
      expect(ago(200) < endedCutoff).toBe(true);
      expect(ago(20) < continuingCutoff).toBe(false);
      expect(ago(40) < continuingCutoff).toBe(true);
    });

    it('never puts a status other than Ended and Canceled on the ended window', async () => {
      await task.run();

      const where = prisma.show.findMany.mock.calls[0][0].where;
      expect(where.OR[1].tmdbStatus).toEqual({ in: ['Ended', 'Canceled'] });
      expect(where.OR[2].OR).toContainEqual({ tmdbStatus: { notIn: ['Ended', 'Canceled'] } });
      expect(where.OR[2].OR).toContainEqual({ tmdbStatus: null });
    });

    it('orders by seasonsSyncedAt ascending, never-synced first', async () => {
      await task.run();

      expect(prisma.show.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { seasonsSyncedAt: { sort: 'asc', nulls: 'first' } },
        }),
      );
    });
  });

  describe('run (REQ-10, REQ-11, REQ-12, NFR-2)', () => {
    it('makes zero calls into ShowsService and reports zero when nothing is due', async () => {
      await expect(task.run()).resolves.toEqual({ itemsProcessed: 0 });

      expect(shows.syncCatalogClaimed).not.toHaveBeenCalled();
    });

    it('refreshes every due series and reports how many', async () => {
      prisma.show.findMany.mockResolvedValue([
        { id: 1, tmdbId: 101 },
        { id: 2, tmdbId: 102 },
      ]);

      await expect(task.run()).resolves.toEqual({ itemsProcessed: 2 });

      expect(shows.syncCatalogClaimed).toHaveBeenNthCalledWith(1, 1, 101);
      expect(shows.syncCatalogClaimed).toHaveBeenNthCalledWith(2, 2, 102);
    });

    it('still refreshes the second series when the first throws, then throws carrying both counts', async () => {
      prisma.show.findMany.mockResolvedValue([
        { id: 1, tmdbId: 101 },
        { id: 2, tmdbId: 102 },
      ]);
      shows.syncCatalogClaimed
        .mockRejectedValueOnce(new Error('TMDB down'))
        .mockResolvedValueOnce(true);

      await expect(task.run()).rejects.toThrow(
        'refresh_shows: 1 of 2 series failed; 1 refreshed successfully',
      );

      expect(shows.syncCatalogClaimed).toHaveBeenCalledTimes(2);
    });

    it('neither counts nor fails a series whose claim is held', async () => {
      prisma.show.findMany.mockResolvedValue([
        { id: 1, tmdbId: 101 },
        { id: 2, tmdbId: 102 },
      ]);
      shows.syncCatalogClaimed.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

      await expect(task.run()).resolves.toEqual({ itemsProcessed: 1 });
    });
  });
});
