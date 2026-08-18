import { Test, TestingModule } from '@nestjs/testing';
import { SeasonsService } from './seasons.service';
import { PrismaService } from '@/prisma/prisma.service';
import { QbittorrentClient } from '@/clients/torrent/client';

// This suite mirrors episodes.service.spec.ts's central concern one relation
// shallower: a season-pack acquisition is the entry point 013-season-pack-
// processing needs to exercise the rest of the pipeline at all (REQ-14), so
// a bug here is invisible anywhere else — it either lets an unowned season
// be attacked, or lets a race between two "active" sources for the same
// season go unnoticed.
//
//  - `findOneFromDb` dropping its ownership join through show -> UserShow
//    would resolve any authenticated caller's season, not just one linked to
//    their library — same failure class as EpisodesService's own block.
//  - The active-source conflict is an application invariant (no unique index
//    on `seasonId`) — a missing `force` branch, or one that creates the
//    replacement before demoting the old row, leaves two "active" sources
//    for the same season with no error, and a late `torrentCompleted` for
//    the superseded hash can move episodes on behalf of a source that lost.
//  - `force` must demote only *after* qBittorrent accepts the new torrent:
//    demoting first and having `add()` reject afterwards would leave the
//    season with no active source and no replacement, silently.
describe('SeasonsService', () => {
  let service: SeasonsService;
  let prisma: {
    season: {
      findFirst: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
    mediaSource: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      updateMany: jest.Mock;
      update: jest.Mock;
      create: jest.Mock;
    };
  };
  let qbittorrent: { add: jest.Mock };

  const season = {
    id: 42,
    seasonNumber: 2,
    show: { id: 1, title: 'Reacher' },
  };

  beforeEach(async () => {
    prisma = {
      season: {
        findFirst: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
      mediaSource: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
    };
    qbittorrent = { add: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SeasonsService,
        { provide: PrismaService, useValue: prisma },
        { provide: QbittorrentClient, useValue: qbittorrent },
      ],
    }).compile();

    service = module.get<SeasonsService>(SeasonsService);
  });

  describe('findOneFromDb', () => {
    it('scopes the query through show -> user_shows', async () => {
      prisma.season.findFirst.mockResolvedValue(season);

      await service.findOneFromDb(42, 'user-1');

      expect(prisma.season.findFirst).toHaveBeenCalledTimes(1);
      const [args] = prisma.season.findFirst.mock.calls[0];
      expect(args.where).toEqual({
        id: 42,
        show: { users: { some: { userId: 'user-1' } } },
      });
    });

    it('returns null for a season the caller is not linked to', async () => {
      prisma.season.findFirst.mockResolvedValue(null);

      await expect(service.findOneFromDb(42, 'user-2')).resolves.toBeNull();
    });
  });

  describe('addMagnetToSeason', () => {
    const magnet =
      'magnet:?xt=urn:btih:abc123def456abc123def456abc123def456abc1&dn=Reacher.S02.1080p';

    it('throws "La temporada <id> no existe" for a missing or unowned season, and creates no source', async () => {
      prisma.season.findFirst.mockResolvedValue(null);

      await expect(service.addMagnetToSeason(42, { magnet, force: false }, 'user-2')).rejects.toThrow(
        'La temporada 42 no existe',
      );
      expect(qbittorrent.add).not.toHaveBeenCalled();
      expect(prisma.mediaSource.create).not.toHaveBeenCalled();
    });

    it('writes seasonId and never episodeId on the created MediaSource, and includes episodes on the final read', async () => {
      prisma.season.findFirst.mockResolvedValue(season);
      prisma.mediaSource.findFirst.mockResolvedValue(null); // no active source
      prisma.mediaSource.findUnique.mockResolvedValue(null); // infoHash unused
      qbittorrent.add.mockResolvedValue('/downloads/reacher-s02');
      prisma.mediaSource.create.mockResolvedValue({ id: 100, seasonId: 42 });
      prisma.season.findUniqueOrThrow.mockResolvedValue({ ...season, episodes: [] });

      await service.addMagnetToSeason(42, { magnet, force: false }, 'user-1');

      expect(prisma.mediaSource.create).toHaveBeenCalledTimes(1);
      const createData = prisma.mediaSource.create.mock.calls[0][0].data;
      expect(createData).toMatchObject({ seasonId: 42 });
      expect(createData).not.toHaveProperty('episodeId');

      expect(prisma.season.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 42 },
        include: { episodes: { orderBy: { episodeNumber: 'asc' } } },
      });
    });

    it('rejects a second acquisition without force, and creates no row', async () => {
      prisma.season.findFirst.mockResolvedValue(season);
      prisma.mediaSource.findFirst.mockResolvedValue({ id: 5, seasonId: 42, status: 'DOWNLOADING' });

      await expect(
        service.addMagnetToSeason(42, { magnet, force: false }, 'user-1'),
      ).rejects.toThrow('Esta temporada ya tiene una descarga en curso. Confirmá para reemplazarla.');

      expect(qbittorrent.add).not.toHaveBeenCalled();
      expect(prisma.mediaSource.create).not.toHaveBeenCalled();
      expect(prisma.mediaSource.updateMany).not.toHaveBeenCalled();
    });

    it('with force, accepts the torrent then demotes the previously active source before creating the replacement', async () => {
      prisma.season.findFirst.mockResolvedValue(season);
      prisma.mediaSource.findFirst.mockResolvedValue({ id: 5, seasonId: 42, status: 'DOWNLOADING' });
      prisma.mediaSource.findUnique.mockResolvedValue(null);
      qbittorrent.add.mockResolvedValue('/downloads/reacher-s02-v2');
      prisma.mediaSource.create.mockResolvedValue({ id: 101, seasonId: 42 });
      prisma.season.findUniqueOrThrow.mockResolvedValue({ ...season, episodes: [] });

      await service.addMagnetToSeason(42, { magnet, force: true }, 'user-1');

      // Ordering matters: qBittorrent must accept the new torrent (proven by
      // the mock resolving) before the previous row is demoted, and the
      // demotion must happen before the replacement is created — otherwise a
      // rejected add() would leave the previously active source wrongly
      // demoted with no replacement.
      const addOrder = qbittorrent.add.mock.invocationCallOrder[0];
      const updateManyOrder = prisma.mediaSource.updateMany.mock.invocationCallOrder[0];
      const createOrder = prisma.mediaSource.create.mock.invocationCallOrder[0];
      expect(addOrder).toBeLessThan(updateManyOrder);
      expect(updateManyOrder).toBeLessThan(createOrder);

      expect(prisma.mediaSource.updateMany).toHaveBeenCalledWith({
        where: { seasonId: 42, status: { not: 'ERROR' } },
        data: { status: 'ERROR', errorMessage: expect.any(String) },
      });
    });

    it('refuses an infoHash already owned by a movie', async () => {
      prisma.season.findFirst.mockResolvedValue(season);
      prisma.mediaSource.findFirst.mockResolvedValue(null);
      prisma.mediaSource.findUnique.mockResolvedValue({
        id: 7,
        movie: { id: 9, title: 'Dune' },
        episode: null,
        season: null,
      });

      await expect(service.addMagnetToSeason(42, { magnet, force: false }, 'user-1')).rejects.toThrow(
        'Ese magnet ya está asociado a «Dune»',
      );
      expect(qbittorrent.add).not.toHaveBeenCalled();
      expect(prisma.mediaSource.create).not.toHaveBeenCalled();
      expect(prisma.mediaSource.update).not.toHaveBeenCalled();
    });

    it('refuses an infoHash already owned by an episode', async () => {
      prisma.season.findFirst.mockResolvedValue(season);
      prisma.mediaSource.findFirst.mockResolvedValue(null);
      prisma.mediaSource.findUnique.mockResolvedValue({
        id: 8,
        movie: null,
        episode: { episodeNumber: 1, season: { seasonNumber: 3, show: { title: 'Reacher' } } },
        season: null,
      });

      await expect(service.addMagnetToSeason(42, { magnet, force: false }, 'user-1')).rejects.toThrow(
        'Ese magnet ya está asociado a «Reacher S03E01»',
      );
      expect(qbittorrent.add).not.toHaveBeenCalled();
      expect(prisma.mediaSource.create).not.toHaveBeenCalled();
    });

    it('refuses an infoHash already owned by a different season', async () => {
      prisma.season.findFirst.mockResolvedValue(season);
      prisma.mediaSource.findFirst.mockResolvedValue(null);
      prisma.mediaSource.findUnique.mockResolvedValue({
        id: 9,
        movie: null,
        episode: null,
        season: { id: 7, seasonNumber: 1, show: { title: 'Reacher' } },
      });

      await expect(service.addMagnetToSeason(42, { magnet, force: false }, 'user-1')).rejects.toThrow(
        'Ese magnet ya está asociado a «Reacher Temporada 1»',
      );
      expect(qbittorrent.add).not.toHaveBeenCalled();
      expect(prisma.mediaSource.create).not.toHaveBeenCalled();
    });

    it('does not treat a re-request against this same season as a collision', async () => {
      prisma.season.findFirst.mockResolvedValue(season);
      prisma.mediaSource.findFirst.mockResolvedValue(null);
      prisma.mediaSource.findUnique.mockResolvedValue({
        id: 5,
        movie: null,
        episode: null,
        season: { id: 42, seasonNumber: 2, show: { title: 'Reacher' } },
      });
      qbittorrent.add.mockResolvedValue('/downloads/reacher-s02');
      prisma.mediaSource.update.mockResolvedValue({ id: 5, seasonId: 42 });
      prisma.season.findUniqueOrThrow.mockResolvedValue({ ...season, episodes: [] });

      await service.addMagnetToSeason(42, { magnet, force: false }, 'user-1');

      expect(prisma.mediaSource.update).toHaveBeenCalledTimes(1);
      expect(prisma.mediaSource.create).not.toHaveBeenCalled();
    });

    it('rejects a malformed magnet before touching qBittorrent or the database', async () => {
      await expect(
        service.addMagnetToSeason(42, { magnet: 'not-a-magnet', force: false }, 'user-1'),
      ).rejects.toThrow();

      expect(prisma.season.findFirst).not.toHaveBeenCalled();
      expect(qbittorrent.add).not.toHaveBeenCalled();
    });

    it('leaves no MediaSource row when qbittorrent.add rejects', async () => {
      prisma.season.findFirst.mockResolvedValue(season);
      prisma.mediaSource.findFirst.mockResolvedValue(null);
      prisma.mediaSource.findUnique.mockResolvedValue(null);
      qbittorrent.add.mockRejectedValue(new Error('qBittorrent rechazó el torrent (500)'));

      await expect(service.addMagnetToSeason(42, { magnet, force: false }, 'user-1')).rejects.toThrow(
        'qBittorrent rechazó el torrent (500)',
      );
      expect(prisma.mediaSource.create).not.toHaveBeenCalled();
      expect(prisma.mediaSource.update).not.toHaveBeenCalled();
    });
  });
});
