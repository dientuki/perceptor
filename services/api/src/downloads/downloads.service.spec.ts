import { Test, TestingModule } from '@nestjs/testing';
import { DownloadsService } from './downloads.service';
import { PrismaService } from '@/prisma/prisma.service';
import { ProcessQueueService } from '@/queue/process-queue.service';
import { QbittorrentClient } from '@/clients/torrent/client';

// This suite exists because two failure classes here produce no error
// anywhere (spec.md NFR-5 (a)/(b)):
//
//  - a loser's torrentCompleted arriving after the winner already reached
//    READY still marking that loser READY and enqueuing a second
//    bull:process — the target ends up with two ProcessJobs writing the
//    same output path, and nothing logs a problem (REQ-13);
//  - the race arbiter stopping the *winner* along with its siblings, or
//    writing a paused loser's status as ERROR instead of PAUSED — either
//    would be silently read by this very function as "superseded, ignore"
//    on the next completion notice, indistinguishable from a legitimately
//    discarded source (REQ-12, NFR-7's whole reason for existing).
//
// The arbiter (resolveRace) is covered once here, directly, rather than a
// second near-identical suite driving it through UploadsService — both
// entry points call the exact same method (api/plan.md § Existing code to
// reuse), so a bug in the shared logic shows up regardless of which
// caller's test exercises it.
describe('DownloadsService', () => {
  let service: DownloadsService;
  let prisma: {
    mediaSource: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
    };
    movie: { update: jest.Mock };
    episode: { update: jest.Mock };
    $transaction: jest.Mock;
  };
  let queue: { addSourceReady: jest.Mock };
  let qbittorrent: { stop: jest.Mock; info: jest.Mock };

  beforeEach(async () => {
    prisma = {
      mediaSource: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      movie: { update: jest.fn() },
      episode: { update: jest.fn() },
      $transaction: jest.fn(async (cb: (tx: unknown) => Promise<void>) => cb(prisma)),
    };
    queue = { addSourceReady: jest.fn() };
    qbittorrent = { stop: jest.fn().mockResolvedValue(undefined), info: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DownloadsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ProcessQueueService, useValue: queue },
        { provide: QbittorrentClient, useValue: qbittorrent },
      ],
    }).compile();

    service = module.get<DownloadsService>(DownloadsService);
  });

  describe('resolveRace', () => {
    it('pauses every other non-terminal sibling and leaves the winner alone', async () => {
      prisma.mediaSource.findUnique.mockResolvedValue({
        id: 1,
        status: 'DOWNLOADING',
        movieId: 7,
        episodeId: null,
        seasonId: null,
      });
      prisma.mediaSource.findMany.mockResolvedValue([
        { id: 2, status: 'DOWNLOADING', infoHash: 'loser-hash-1' },
        { id: 3, status: 'PAUSED', infoHash: 'loser-hash-2' },
      ]);

      const result = await service.resolveRace(1);

      expect(result).toMatch(/^ganador/);
      // The winner (mediaSource 1) must never be touched here — its own
      // status transition belongs to the caller (handleTorrentCompleted /
      // UploadsService.onUploadFinish), not to the arbiter.
      expect(prisma.mediaSource.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 1 } }),
      );
      // Every non-terminal sibling is stopped in the client and moved to
      // PAUSED — never ERROR, which handleTorrentCompleted itself reads as
      // "superseded, ignore".
      expect(qbittorrent.stop).toHaveBeenCalledWith('loser-hash-1');
      expect(qbittorrent.stop).toHaveBeenCalledWith('loser-hash-2');
      expect(prisma.mediaSource.update).toHaveBeenCalledWith({ where: { id: 2 }, data: { status: 'PAUSED' } });
      expect(prisma.mediaSource.update).toHaveBeenCalledWith({ where: { id: 3 }, data: { status: 'PAUSED' } });
    });

    // REQ-13: this is the exact case a loser's late completion must be
    // ignored — if this guard were removed, a second source of the same
    // target would sail through to READY/ENCODING with nothing to catch it.
    it('reports "ignorado" and pauses nothing when a sibling already won', async () => {
      prisma.mediaSource.findUnique.mockResolvedValue({
        id: 2,
        status: 'DOWNLOADING',
        movieId: 7,
        episodeId: null,
        seasonId: null,
      });
      prisma.mediaSource.findMany.mockResolvedValue([
        { id: 1, status: 'READY', infoHash: 'winner-hash' },
      ]);

      const result = await service.resolveRace(2);

      expect(result).toMatch(/^ignorado/);
      expect(qbittorrent.stop).not.toHaveBeenCalled();
      expect(prisma.mediaSource.update).not.toHaveBeenCalled();
    });

    it('does not treat an already-ERROR source as a valid winner', async () => {
      prisma.mediaSource.findUnique.mockResolvedValue({
        id: 5,
        status: 'ERROR',
        movieId: 7,
        episodeId: null,
        seasonId: null,
      });

      const result = await service.resolveRace(5);

      expect(result).toMatch(/^ignorado/);
      expect(prisma.mediaSource.findMany).not.toHaveBeenCalled();
      expect(qbittorrent.stop).not.toHaveBeenCalled();
    });

    it('never pauses a sibling whose stop the torrent client rejected, and never writes PAUSED for it', async () => {
      prisma.mediaSource.findUnique.mockResolvedValue({
        id: 1,
        status: 'DOWNLOADING',
        movieId: 7,
        episodeId: null,
        seasonId: null,
      });
      prisma.mediaSource.findMany.mockResolvedValue([
        { id: 2, status: 'DOWNLOADING', infoHash: 'unreachable-hash' },
      ]);
      qbittorrent.stop.mockRejectedValueOnce(new Error('qBittorrent unreachable'));

      const result = await service.resolveRace(1);

      // NFR-6: an unacknowledged stop must not be written to the DB as
      // PAUSED — that would leave the sibling downloading while the row
      // lies about it.
      expect(prisma.mediaSource.update).not.toHaveBeenCalled();
      expect(result).toMatch(/^ganador.*0 pausado/);
    });
  });

  describe('handleTorrentCompleted — REQ-13 one-winner guard', () => {
    // Fault injection: comment out the resolveRace call in
    // handleTorrentCompleted (or move it after the READY-marking
    // transaction) and this case starts asserting a second
    // bull:process job and a status change that must never happen.
    it('leaves a late-arriving loser untouched and enqueues nothing when a sibling already reached READY', async () => {
      prisma.mediaSource.findUnique.mockResolvedValue({
        id: 2,
        infoHash: 'loser-hash',
        status: 'DOWNLOADING',
        downloadPath: '/media/downloads/abc123',
        movieId: 7,
        episodeId: null,
        seasonId: null,
        movie: { id: 7 },
        episode: null,
      });
      prisma.mediaSource.findMany.mockResolvedValue([
        { id: 1, status: 'READY', infoHash: 'winner-hash' },
      ]);

      const result = await service.handleTorrentCompleted('loser-hash');

      expect(result).toMatch(/^ignorado/);
      expect(prisma.mediaSource.update).not.toHaveBeenCalled();
      expect(prisma.movie.update).not.toHaveBeenCalled();
      expect(queue.addSourceReady).not.toHaveBeenCalled();
    });

    it('marks READY, moves the target to ENCODING and enqueues once when there is no competing winner', async () => {
      prisma.mediaSource.findUnique.mockResolvedValue({
        id: 1,
        infoHash: 'winner-hash',
        status: 'DOWNLOADING',
        downloadPath: '/media/downloads/abc123',
        movieId: 7,
        episodeId: null,
        seasonId: null,
        movie: { id: 7 },
        episode: null,
      });
      prisma.mediaSource.findMany.mockResolvedValue([]); // no siblings at all

      const result = await service.handleTorrentCompleted('winner-hash');

      expect(result).toMatch(/^encolado/);
      expect(prisma.mediaSource.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: 'READY' },
      });
      expect(prisma.movie.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { status: 'ENCODING' } });
      expect(queue.addSourceReady).toHaveBeenCalledWith({ mediaSourceId: 1 });
    });
  });
});
