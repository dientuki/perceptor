import { Test, TestingModule } from '@nestjs/testing';
import { EpisodesService } from './episodes.service';
import { PrismaService } from '@/prisma/prisma.service';
import { QbittorrentClient } from '@/clients/torrent/client';

// This suite exists because 010-episode-acquisition's central bug class is
// silent by construction: an episode's acquisition landing on a film, or an
// episode's source being silently stolen by another title, raises no
// exception anywhere and leaves the caller looking at a success response.
//
//  - `attachTorrentSource` must write `episodeId` and never `movieId` on the
//    `MediaSource` it creates. Both are plain numbers, so a swapped field
//    compiles and returns 200 — only asserting on what was actually handed
//    to Prisma catches it (NFR-5).
//  - `findOneFromDb` dropping (or never applying) its ownership join through
//    season -> show -> UserShow would resolve any authenticated caller's
//    episode, not just the one linked to it — same failure class
//    `movies.service.spec.ts`'s `findOneFromDb` block defends against, one
//    relation deeper.
//  - The active-source conflict is an application invariant, not a database
//    constraint (there is no unique index on `episodeId`, see api/plan.md §
//    Migrations) — a missing `force` branch, or one that creates the
//    replacement before demoting the old row, leaves two "active" sources
//    with no error, and a late `torrentCompleted` for the superseded hash
//    can move the episode on behalf of a source that lost.
//  - `infoHash` is globally unique, and `MediaSource` can now be owned by
//    either a movie or an episode. A collision check that only inspects one
//    side of that union silently re-points someone else's source at this
//    episode instead of refusing.
describe('EpisodesService', () => {
  let service: EpisodesService;
  let prisma: {
    episode: {
      findFirst: jest.Mock;
      update: jest.Mock;
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

  const episode = {
    id: 42,
    episodeNumber: 1,
    season: { seasonNumber: 4, show: { id: 1, title: 'Reacher' } },
  };

  beforeEach(async () => {
    prisma = {
      episode: {
        findFirst: jest.fn(),
        update: jest.fn(),
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
        EpisodesService,
        { provide: PrismaService, useValue: prisma },
        { provide: QbittorrentClient, useValue: qbittorrent },
      ],
    }).compile();

    service = module.get<EpisodesService>(EpisodesService);
  });

  describe('findOneFromDb', () => {
    it('scopes the query through season -> show -> user_shows', async () => {
      prisma.episode.findFirst.mockResolvedValue(episode);

      await service.findOneFromDb(42, 'user-1');

      // A version that keeps `where: { id }` and moves the join into
      // `include` would pass a looser assertion while being entirely
      // unscoped — full equality on the where-clause, same technique
      // movies.service.spec.ts's findOneFromDb block uses.
      expect(prisma.episode.findFirst).toHaveBeenCalledTimes(1);
      const [args] = prisma.episode.findFirst.mock.calls[0];
      expect(args.where).toEqual({
        id: 42,
        season: { show: { users: { some: { userId: 'user-1' } } } },
      });
    });

    it('returns null for an episode the caller is not linked to', async () => {
      prisma.episode.findFirst.mockResolvedValue(null);

      await expect(service.findOneFromDb(42, 'user-2')).resolves.toBeNull();
    });
  });

  describe('addTorrentToEpisode', () => {
    const validInput = {
      infoHash: 'abc123def456abc123def456abc123def456abc',
      urls: ['magnet:?xt=urn:btih:abc123'],
      releaseTitle: 'Reacher S04E01',
      force: false,
    };

    it('throws "El episodio <id> no existe" for a missing or unowned episode, and creates no source', async () => {
      prisma.episode.findFirst.mockResolvedValue(null);

      await expect(service.addTorrentToEpisode(42, validInput, 'user-2')).rejects.toThrow(
        'El episodio 42 no existe',
      );
      expect(qbittorrent.add).not.toHaveBeenCalled();
      expect(prisma.mediaSource.create).not.toHaveBeenCalled();
    });

    it('writes episodeId and never movieId on the created MediaSource', async () => {
      prisma.episode.findFirst.mockResolvedValue(episode);
      prisma.mediaSource.findFirst.mockResolvedValue(null); // no active source
      prisma.mediaSource.findUnique.mockResolvedValue(null); // infoHash unused
      qbittorrent.add.mockResolvedValue('/downloads/reacher-s04e01');
      prisma.mediaSource.create.mockResolvedValue({ id: 100, episodeId: 42 });
      prisma.episode.findUniqueOrThrow.mockResolvedValue({ ...episode, status: 'DOWNLOADING' });

      await service.addTorrentToEpisode(42, validInput, 'user-1');

      expect(prisma.mediaSource.create).toHaveBeenCalledTimes(1);
      const createData = prisma.mediaSource.create.mock.calls[0][0].data;
      expect(createData).toMatchObject({ episodeId: 42 });
      expect(createData).not.toHaveProperty('movieId');

      expect(prisma.episode.update).toHaveBeenCalledWith({
        where: { id: 42 },
        data: { status: 'DOWNLOADING' },
      });
    });

    it('rejects a second acquisition without force, and creates no row', async () => {
      prisma.episode.findFirst.mockResolvedValue(episode);
      prisma.mediaSource.findFirst.mockResolvedValue({ id: 5, episodeId: 42, status: 'DOWNLOADING' });

      await expect(
        service.addTorrentToEpisode(42, { ...validInput, force: false }, 'user-1'),
      ).rejects.toThrow('Este episodio ya tiene una descarga en curso. Confirmá para reemplazarla.');

      expect(qbittorrent.add).not.toHaveBeenCalled();
      expect(prisma.mediaSource.create).not.toHaveBeenCalled();
      expect(prisma.mediaSource.updateMany).not.toHaveBeenCalled();
    });

    it('with force, demotes the previously active source to ERROR before creating the replacement', async () => {
      prisma.episode.findFirst.mockResolvedValue(episode);
      prisma.mediaSource.findFirst.mockResolvedValue({ id: 5, episodeId: 42, status: 'DOWNLOADING' });
      prisma.mediaSource.findUnique.mockResolvedValue(null);
      qbittorrent.add.mockResolvedValue('/downloads/reacher-s04e01-v2');
      prisma.mediaSource.create.mockResolvedValue({ id: 101, episodeId: 42 });
      prisma.episode.findUniqueOrThrow.mockResolvedValue({ ...episode, status: 'DOWNLOADING' });

      await service.addTorrentToEpisode(42, { ...validInput, force: true }, 'user-1');

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
        where: { episodeId: 42, status: { not: 'ERROR' } },
        data: { status: 'ERROR', errorMessage: expect.any(String) },
      });
    });

    it('refuses an infoHash already owned by a movie', async () => {
      prisma.episode.findFirst.mockResolvedValue(episode);
      prisma.mediaSource.findFirst.mockResolvedValue(null);
      prisma.mediaSource.findUnique.mockResolvedValue({
        id: 7,
        movie: { id: 9, title: 'Dune' },
        episodeId: null,
      });

      await expect(service.addTorrentToEpisode(42, validInput, 'user-1')).rejects.toThrow(
        'Ese magnet ya está asociado a «Dune»',
      );
      expect(qbittorrent.add).not.toHaveBeenCalled();
      expect(prisma.mediaSource.create).not.toHaveBeenCalled();
      expect(prisma.mediaSource.update).not.toHaveBeenCalled();
    });

    it('refuses an infoHash already owned by a different episode', async () => {
      prisma.episode.findFirst.mockResolvedValue(episode);
      prisma.mediaSource.findFirst.mockResolvedValue(null);
      prisma.mediaSource.findUnique.mockResolvedValue({
        id: 8,
        movie: null,
        episodeId: 999,
      });

      await expect(service.addTorrentToEpisode(42, validInput, 'user-1')).rejects.toThrow(
        'Ese magnet ya está asociado a «Reacher S04E01»',
      );
      expect(qbittorrent.add).not.toHaveBeenCalled();
      expect(prisma.mediaSource.create).not.toHaveBeenCalled();
      expect(prisma.mediaSource.update).not.toHaveBeenCalled();
    });

    it('leaves no MediaSource row when qbittorrent.add rejects', async () => {
      prisma.episode.findFirst.mockResolvedValue(episode);
      prisma.mediaSource.findFirst.mockResolvedValue(null);
      prisma.mediaSource.findUnique.mockResolvedValue(null);
      qbittorrent.add.mockRejectedValue(new Error('qBittorrent rechazó el torrent (500)'));

      await expect(service.addTorrentToEpisode(42, validInput, 'user-1')).rejects.toThrow(
        'qBittorrent rechazó el torrent (500)',
      );
      expect(prisma.mediaSource.create).not.toHaveBeenCalled();
      expect(prisma.mediaSource.update).not.toHaveBeenCalled();
      expect(prisma.episode.update).not.toHaveBeenCalled();
    });
  });
});
