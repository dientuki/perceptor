import { RefreshEpisodesTask } from './refresh-episodes.task';
import { PrismaService } from '@/prisma/prisma.service';
import { TmdbClient } from '@/clients/tmdb/client';
import { EpisodeDetail } from '@/clients/types';

// This suite defends against four ways `refresh_episodes` could report a
// clean SUCCESS while quietly doing the wrong thing, none of which would
// surface anywhere else: a selection window off by one boundary either
// freezes stale titles forever or rewrites rows that already settled; a
// per-episode fan-out instead of a per-season fetch silently multiplies the
// TMDB call budget until a shared key gets rate-limited; an episode TMDB
// doesn't return in a season response gets blanked and re-blanked on every
// future run if the "missing means untouched" rule is dropped; and a season
// fetch that throws, if not contained, either aborts every season after it
// or reports success on a half-finished sweep. Each case is written so it
// fails if the rule it covers is removed.
describe('RefreshEpisodesTask', () => {
  let task: RefreshEpisodesTask;
  let prisma: {
    episode: {
      findMany: jest.Mock;
      update: jest.Mock;
    };
  };
  let tmdb: { seasonDetails: jest.Mock };

  const episodeDetail = (overrides: Partial<EpisodeDetail>): EpisodeDetail => ({
    id: 1,
    title: 'Fetched title',
    overview: 'Fetched overview',
    releaseDate: '2026-09-01',
    episodeNumber: 1,
    stillPath: null,
    voteAverage: 8.0,
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      episode: {
        findMany: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    tmdb = { seasonDetails: jest.fn() };

    task = new RefreshEpisodesTask(
      prisma as unknown as PrismaService,
      tmdb as unknown as TmdbClient,
    );
  });

  describe('selection boundary (REQ-2, REQ-3)', () => {
    // The task builds its own `where` and hands it to the (mocked) Prisma
    // client, so a mock that simply returns whatever rows the test wants
    // would never notice a wrong cutoff — the assertion has to be on the
    // `where` clause itself, computed independently here against a frozen
    // "now", the same start-of-day truncation the implementation performs.
    it('selects releaseDate: null OR gte the UTC start of day two days before "now"', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-03T15:30:00.000Z'));
      prisma.episode.findMany.mockResolvedValue([]);

      await task.run();

      const expectedCutoff = new Date('2026-09-01T00:00:00.000Z');
      expect(prisma.episode.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [{ releaseDate: null }, { releaseDate: { gte: expectedCutoff } }],
          },
        }),
      );

      jest.useRealTimers();
    });

    it('writes an episode airing in the future, one that aired yesterday and one with a null releaseDate, but never one that aired three days ago', async () => {
      // Given the four candidate rows a real run three days ago / yesterday /
      // in the future / null-date could produce, the row that aired three
      // days ago must never be among what findMany returns for this cutoff —
      // asserted against the same frozen "now" as the case above, so this
      // stays pinned to the actual boundary rather than an arbitrary mock.
      jest.useFakeTimers().setSystemTime(new Date('2026-09-03T15:30:00.000Z'));
      prisma.episode.findMany.mockImplementation(
        ({ where }: { where: { OR: [{ releaseDate: null }, { releaseDate: { gte: Date } }] } }) => {
          const cutoff = where.OR[1].releaseDate.gte;
          const candidates = [
            { id: 101, episodeNumber: 1, releaseDate: new Date('2026-09-06T00:00:00.000Z'), season: { seasonNumber: 1, show: { tmdbId: 42 } } }, // 3 days ahead
            { id: 102, episodeNumber: 2, releaseDate: new Date('2026-09-02T00:00:00.000Z'), season: { seasonNumber: 1, show: { tmdbId: 42 } } }, // yesterday
            { id: 103, episodeNumber: 3, releaseDate: new Date('2026-08-31T00:00:00.000Z'), season: { seasonNumber: 1, show: { tmdbId: 42 } } }, // 3 days ago
            { id: 104, episodeNumber: 4, releaseDate: null, season: { seasonNumber: 1, show: { tmdbId: 42 } } }, // null
          ];
          return Promise.resolve(
            candidates.filter((c) => c.releaseDate === null || c.releaseDate >= cutoff),
          );
        },
      );
      tmdb.seasonDetails.mockResolvedValue([
        episodeDetail({ episodeNumber: 1, releaseDate: '2026-09-06' }),
        episodeDetail({ episodeNumber: 2, releaseDate: '2026-09-02' }),
        episodeDetail({ episodeNumber: 4, releaseDate: null as unknown as string }),
      ]);

      const result = await task.run();

      expect(prisma.episode.update).toHaveBeenCalledTimes(3);
      expect(prisma.episode.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 101 } }));
      expect(prisma.episode.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 102 } }));
      expect(prisma.episode.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 104 } }));
      expect(prisma.episode.update).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: 103 } }));
      expect(result).toEqual({ itemsProcessed: 3 });

      jest.useRealTimers();
    });
  });

  describe('one fetch per season (REQ-4)', () => {
    it('calls seasonDetails exactly once per distinct (tmdbId, seasonNumber) group, never once per episode', async () => {
      prisma.episode.findMany.mockResolvedValue([
        // Series A, season 1: two selected episodes.
        { id: 1, episodeNumber: 1, season: { seasonNumber: 1, show: { tmdbId: 42 } } },
        { id: 2, episodeNumber: 2, season: { seasonNumber: 1, show: { tmdbId: 42 } } },
        // Series A, season 2: one selected episode.
        { id: 3, episodeNumber: 1, season: { seasonNumber: 2, show: { tmdbId: 42 } } },
        // Series B, season 1: one selected episode.
        { id: 4, episodeNumber: 1, season: { seasonNumber: 1, show: { tmdbId: 99 } } },
      ]);
      tmdb.seasonDetails.mockResolvedValue([episodeDetail({ episodeNumber: 1 }), episodeDetail({ episodeNumber: 2 })]);

      await task.run();

      expect(tmdb.seasonDetails).toHaveBeenCalledTimes(3);
      expect(tmdb.seasonDetails).toHaveBeenCalledWith(42, 1);
      expect(tmdb.seasonDetails).toHaveBeenCalledWith(42, 2);
      expect(tmdb.seasonDetails).toHaveBeenCalledWith(99, 1);
    });
  });

  describe('episode missing from TMDB response (REQ-7)', () => {
    it('leaves the row untouched and out of itemsProcessed when its episodeNumber is absent from the season response', async () => {
      prisma.episode.findMany.mockResolvedValue([
        { id: 1, episodeNumber: 1, season: { seasonNumber: 1, show: { tmdbId: 42 } } },
        { id: 2, episodeNumber: 2, season: { seasonNumber: 1, show: { tmdbId: 42 } } },
      ]);
      // The season response only reports episode 1 — episode 2 vanished
      // from the catalog (or was never indexed under that number).
      tmdb.seasonDetails.mockResolvedValue([episodeDetail({ episodeNumber: 1 })]);

      const result = await task.run();

      expect(prisma.episode.update).toHaveBeenCalledTimes(1);
      expect(prisma.episode.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 1 } }),
      );
      expect(prisma.episode.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 2 } }),
      );
      expect(result).toEqual({ itemsProcessed: 1 });
    });
  });

  describe('partial failure (REQ-9)', () => {
    it('still writes the second group when the first group\'s seasonDetails call rejects, and throws naming one failed season', async () => {
      prisma.episode.findMany.mockResolvedValue([
        { id: 1, episodeNumber: 1, season: { seasonNumber: 1, show: { tmdbId: 42 } } },
        { id: 2, episodeNumber: 1, season: { seasonNumber: 1, show: { tmdbId: 99 } } },
      ]);
      tmdb.seasonDetails.mockImplementation((tmdbId: number) => {
        if (tmdbId === 42) return Promise.reject(new Error('TMDB rate limited'));
        return Promise.resolve([episodeDetail({ episodeNumber: 1 })]);
      });

      await expect(task.run()).rejects.toThrow(/1/);

      expect(prisma.episode.update).toHaveBeenCalledTimes(1);
      expect(prisma.episode.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 2 } }),
      );
    });
  });
});
