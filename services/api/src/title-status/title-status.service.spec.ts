import { Test, TestingModule } from '@nestjs/testing';
import { TitleStatusService } from './title-status.service';
import { PrismaService } from '@/prisma/prisma.service';

// This suite exists because every failure mode this service guards against is silent (089
// spec.md § Context, api/plan.md § Tests): a season-scoped recompute that forgets to walk its
// episodes leaves the 059 lift stuck at QUEUED forever with nothing throwing; an episode
// recompute that does not cascade to its series leaves a series reading COMPLETED after an
// episode is lost, with no error anywhere; and a media-server-promoted target with no filePath,
// no source and no job demoted back to MISSING by a routine recompute looks exactly like a
// correct answer unless it is asserted against directly.
describe('TitleStatusService', () => {
  let service: TitleStatusService;
  let prisma: {
    movie: { findUnique: jest.Mock; updateMany: jest.Mock };
    episode: { findUnique: jest.Mock; updateMany: jest.Mock };
    season: { findUnique: jest.Mock };
    show: { findUnique: jest.Mock; updateMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      movie: { findUnique: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      episode: { findUnique: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      season: { findUnique: jest.fn() },
      show: { findUnique: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [TitleStatusService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<TitleStatusService>(TitleStatusService);
  });

  describe('recomputeMovie', () => {
    it('is a silent no-op for a movie that no longer exists', async () => {
      prisma.movie.findUnique.mockResolvedValue(null);

      await service.recomputeMovie(999);

      expect(prisma.movie.updateMany).not.toHaveBeenCalled();
    });

    // Spec 069, REQ-17; Spec 089, AC-8 REQ-4
    it('does not demote a film the media server holds, with no filePath, source or job', async () => {
      prisma.movie.findUnique.mockResolvedValue({
        id: 7,
        status: 'COMPLETED',
        filePath: null,
        mediaServerPresentAt: new Date('2026-01-01'),
        mediaSources: [],
        processJobs: [],
      });

      await service.recomputeMovie(7);

      expect(prisma.movie.updateMany).toHaveBeenCalledWith({
        where: { id: 7, status: 'COMPLETED' },
        data: { status: 'COMPLETED' },
      });
    });

    // Spec 089, AC-11 NFR-5
    it('reads COMPLETED from filePath alone when mediaServerPresentAt is null (no media server configured)', async () => {
      prisma.movie.findUnique.mockResolvedValue({
        id: 8,
        status: 'COMPLETED',
        filePath: '/library/film.mkv',
        mediaServerPresentAt: null,
        mediaSources: [],
        processJobs: [],
      });

      await service.recomputeMovie(8);

      expect(prisma.movie.updateMany).toHaveBeenCalledWith({
        where: { id: 8, status: 'COMPLETED' },
        data: { status: 'COMPLETED' },
      });
    });

    it('lowers a movie whose only source is now PAUSED, guarded by the status it read', async () => {
      prisma.movie.findUnique.mockResolvedValue({
        id: 9,
        status: 'DOWNLOADING',
        filePath: null,
        mediaServerPresentAt: null,
        mediaSources: [{ status: 'PAUSED' }],
        processJobs: [],
      });

      await service.recomputeMovie(9);

      expect(prisma.movie.updateMany).toHaveBeenCalledWith({
        where: { id: 9, status: 'DOWNLOADING' },
        data: { status: 'PAUSED' },
      });
    });
  });

  describe('recomputeEpisode', () => {
    it('is a silent no-op for an episode that no longer exists, and never recomputes a show', async () => {
      prisma.episode.findUnique.mockResolvedValue(null);

      await service.recomputeEpisode(999);

      expect(prisma.episode.updateMany).not.toHaveBeenCalled();
      expect(prisma.show.findUnique).not.toHaveBeenCalled();
    });

    // Spec 089, AC-9 REQ-4
    it('does not demote an episode the media server holds, and cascades its series to COMPLETED', async () => {
      prisma.episode.findUnique.mockResolvedValue({
        id: 21,
        status: 'COMPLETED',
        filePath: null,
        mediaServerPresentAt: new Date('2026-01-01'),
        releaseDate: new Date('2025-01-01'),
        mediaSources: [],
        processJobs: [],
        season: { showId: 3, mediaSources: [] },
      });
      prisma.show.findUnique.mockResolvedValue({
        status: 'MISSING',
        seasons: [{ episodes: [{ status: 'COMPLETED', releaseDate: new Date('2025-01-01') }] }],
      });

      await service.recomputeEpisode(21);

      expect(prisma.episode.updateMany).toHaveBeenCalledWith({
        where: { id: 21, status: 'COMPLETED' },
        data: { status: 'COMPLETED' },
      });
      expect(prisma.show.updateMany).toHaveBeenCalledWith({
        where: { id: 3, status: 'MISSING' },
        data: { status: 'COMPLETED' },
      });
    });

    // A series reading COMPLETED after one of its episodes loses its delivered copy must stop
    // reading COMPLETED — the cascade is what makes that true without a second notification.
    it('cascades a lost episode down to its series', async () => {
      prisma.episode.findUnique.mockResolvedValue({
        id: 22,
        status: 'COMPLETED',
        filePath: null,
        mediaServerPresentAt: null,
        releaseDate: new Date('2025-01-01'),
        mediaSources: [],
        processJobs: [],
        season: { showId: 4, mediaSources: [] },
      });
      prisma.show.findUnique.mockResolvedValue({
        status: 'COMPLETED',
        seasons: [{ episodes: [{ status: 'MISSING', releaseDate: new Date('2025-01-01') }] }],
      });

      await service.recomputeEpisode(22);

      expect(prisma.episode.updateMany).toHaveBeenCalledWith({
        where: { id: 22, status: 'COMPLETED' },
        data: { status: 'MISSING' },
      });
      expect(prisma.show.updateMany).toHaveBeenCalledWith({
        where: { id: 4, status: 'COMPLETED' },
        data: { status: 'MISSING' },
      });
    });
  });

  describe('recomputeSeason', () => {
    it('is a silent no-op for a season that no longer exists', async () => {
      prisma.season.findUnique.mockResolvedValue(null);

      await service.recomputeSeason(999);

      expect(prisma.episode.findUnique).not.toHaveBeenCalled();
      expect(prisma.show.findUnique).not.toHaveBeenCalled();
    });

    // Spec 089, AC-14 REQ-13
    it('recomputes every episode of the season, un-writing the season-pack lift once the pack is gone', async () => {
      prisma.season.findUnique.mockResolvedValue({
        showId: 5,
        episodes: [{ id: 101 }, { id: 102 }],
      });
      prisma.episode.findUnique.mockImplementation(({ where: { id } }: { where: { id: number } }) =>
        Promise.resolve({
          id,
          status: 'QUEUED', // left over from the season-pack lift while the pack was in flight
          filePath: null,
          mediaServerPresentAt: null,
          releaseDate: new Date('2025-01-01'),
          mediaSources: [],
          processJobs: [],
          season: { showId: 5, mediaSources: [] }, // the pack is gone: no season-scoped source left
        }),
      );
      prisma.show.findUnique.mockResolvedValue({
        status: 'QUEUED',
        seasons: [{ episodes: [{ status: 'MISSING', releaseDate: new Date('2025-01-01') }] }],
      });

      await service.recomputeSeason(5);

      expect(prisma.episode.findUnique).toHaveBeenCalledTimes(2);
      expect(prisma.episode.updateMany).toHaveBeenCalledWith({
        where: { id: 101, status: 'QUEUED' },
        data: { status: 'MISSING' },
      });
      expect(prisma.episode.updateMany).toHaveBeenCalledWith({
        where: { id: 102, status: 'QUEUED' },
        data: { status: 'MISSING' },
      });
      // The show is recomputed once at the end, not once per episode.
      expect(prisma.show.findUnique).toHaveBeenCalledTimes(1);
    });
  });

  describe('recomputeShow', () => {
    it('is a silent no-op for a show that no longer exists', async () => {
      prisma.show.findUnique.mockResolvedValue(null);

      await service.recomputeShow(999);

      expect(prisma.show.updateMany).not.toHaveBeenCalled();
    });

    it('reads MISSING for a series with no aired episode', async () => {
      prisma.show.findUnique.mockResolvedValue({
        status: 'COMPLETED',
        seasons: [{ episodes: [{ status: 'MISSING', releaseDate: new Date('2099-01-01') }] }],
      });

      await service.recomputeShow(6);

      expect(prisma.show.updateMany).toHaveBeenCalledWith({
        where: { id: 6, status: 'COMPLETED' },
        data: { status: 'MISSING' },
      });
    });
  });
});
