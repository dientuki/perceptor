import { Test, TestingModule } from '@nestjs/testing';
import { rm, rmdir } from 'node:fs/promises';
import { DownloadsService } from './downloads.service';
import { PrismaService } from '@/prisma/prisma.service';
import { ProcessQueueService } from '@/queue/process-queue.service';
import { EncodeQueueService } from '@/queue/encode-queue.service';
import { QbittorrentClient } from '@/clients/torrent/client';
import { SettingsService } from '@/settings/settings.service';
import { MediaRootsService } from '@/media-roots/media-roots.service';

jest.mock('node:fs/promises', () => ({
  rm: jest.fn().mockResolvedValue(undefined),
  rmdir: jest.fn().mockResolvedValue(undefined),
}));

// This suite exists because two failure classes here produce no error
// anywhere (Spec 022, NFR-5):
//
//  - a loser's torrentCompleted arriving after the winner already reached
//    READY still marking that loser READY and enqueuing a second
//    bull:process — the target ends up with two ProcessJobs writing the
//    same output path, and nothing logs a problem (Spec 022, REQ-13);
//  - the global downloads list reading `owned: true` for a title the caller
//    never added, which makes the page offer controls the mutations then
//    refuse, and the sidebar badge counting sources or paused work instead
//    of titles in flight, so it silently disagrees with the page beside it;
//  - the race arbiter stopping the *winner* along with its siblings, or
//    writing a paused loser's status as ERROR instead of PAUSED — either
//    would be silently read by this very function as "superseded, ignore"
//    on the next completion notice, indistinguishable from a legitimately
//    discarded source (Spec 022, REQ-12 NFR-7).
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
      updateMany: jest.Mock;
      delete: jest.Mock;
    };
    movie: { update: jest.Mock; findFirst: jest.Mock; findUnique: jest.Mock };
    show: { findFirst: jest.Mock };
    episode: { update: jest.Mock; findUnique: jest.Mock; findMany: jest.Mock };
    processJob: { findMany: jest.Mock; updateMany: jest.Mock };
    setting: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let queue: { addSourceReady: jest.Mock; removeSourceReady: jest.Mock };
  let encodeQueue: { publishCancel: jest.Mock; removeEncode: jest.Mock; addEncode: jest.Mock };
  let qbittorrent: { stop: jest.Mock; start: jest.Mock; info: jest.Mock; remove: jest.Mock };
  let settings: { getMap: jest.Mock };
  let mediaRoots: { resolveFromRoot: jest.Mock; isInsideRoot: jest.Mock };

  beforeEach(async () => {
    prisma = {
      mediaSource: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        delete: jest.fn(),
      },
      movie: { update: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn() },
      show: { findFirst: jest.fn() },
      episode: { update: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
      processJob: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      setting: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (cb: (tx: unknown) => Promise<void>) => cb(prisma)),
    };
    queue = { addSourceReady: jest.fn(), removeSourceReady: jest.fn() };
    encodeQueue = { publishCancel: jest.fn(), removeEncode: jest.fn(), addEncode: jest.fn() };
    qbittorrent = {
      stop: jest.fn().mockResolvedValue(undefined),
      start: jest.fn().mockResolvedValue(undefined),
      info: jest.fn().mockResolvedValue([]),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    settings = { getMap: jest.fn().mockResolvedValue({}) };
    mediaRoots = {
      resolveFromRoot: jest.fn().mockResolvedValue('/media/downloads'),
      isInsideRoot: jest.fn().mockResolvedValue(true),
    };

    (rm as jest.Mock).mockClear().mockResolvedValue(undefined);
    (rmdir as jest.Mock).mockClear().mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DownloadsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ProcessQueueService, useValue: queue },
        { provide: EncodeQueueService, useValue: encodeQueue },
        { provide: QbittorrentClient, useValue: qbittorrent },
        { provide: SettingsService, useValue: settings },
        { provide: MediaRootsService, useValue: mediaRoots },
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

      expect(result.outcome).toBe('WON');
      expect(result.message).toMatch(/^ganador/);
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

    // Spec 022, REQ-13

    // Spec 087, REQ-5
    it('reports SUPERSEDED, stops its own torrent (when it has one) and records the loss, pausing no sibling', async () => {
      prisma.mediaSource.findUnique.mockResolvedValue({
        id: 2,
        status: 'DOWNLOADING',
        infoHash: 'loser-own-hash',
        movieId: 7,
        episodeId: null,
        seasonId: null,
      });
      prisma.mediaSource.findMany.mockResolvedValue([
        { id: 1, status: 'READY', infoHash: 'winner-hash' },
      ]);

      const result = await service.resolveRace(2);

      expect(result.outcome).toBe('SUPERSEDED');
      expect(result.message).toMatch(/^ignorado/);
      expect(qbittorrent.stop).toHaveBeenCalledWith('loser-own-hash');
      // The winner (mediaSource 1) must never be touched by this branch.
      expect(prisma.mediaSource.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 1 } }),
      );
      expect(prisma.mediaSource.update).toHaveBeenCalledWith({
        where: { id: 2 },
        data: {
          status: 'ERROR',
          errorKey: 'error.source.superseded',
          errorMessage: expect.any(String),
          errorParams: null,
        },
      });
    });

    it('records a superseded source with no infoHash without calling stop', async () => {
      prisma.mediaSource.findUnique.mockResolvedValue({
        id: 2,
        status: 'DOWNLOADING',
        infoHash: null,
        movieId: 7,
        episodeId: null,
        seasonId: null,
      });
      prisma.mediaSource.findMany.mockResolvedValue([
        { id: 1, status: 'READY', infoHash: 'winner-hash' },
      ]);

      const result = await service.resolveRace(2);

      expect(result.outcome).toBe('SUPERSEDED');
      expect(qbittorrent.stop).not.toHaveBeenCalled();
      expect(prisma.mediaSource.update).toHaveBeenCalledWith({
        where: { id: 2 },
        data: {
          status: 'ERROR',
          errorKey: 'error.source.superseded',
          errorMessage: expect.any(String),
          errorParams: null,
        },
      });
    });

    it('still reports SUPERSEDED and records the loss when stopping the torrent throws', async () => {
      prisma.mediaSource.findUnique.mockResolvedValue({
        id: 2,
        status: 'DOWNLOADING',
        infoHash: 'loser-own-hash',
        movieId: 7,
        episodeId: null,
        seasonId: null,
      });
      prisma.mediaSource.findMany.mockResolvedValue([
        { id: 1, status: 'READY', infoHash: 'winner-hash' },
      ]);
      qbittorrent.stop.mockRejectedValueOnce(new Error('qBittorrent unreachable'));
      jest.spyOn(console, 'error').mockImplementation(() => undefined);

      const result = await service.resolveRace(2);

      expect(result.outcome).toBe('SUPERSEDED');
      expect(prisma.mediaSource.update).toHaveBeenCalledWith({
        where: { id: 2 },
        data: {
          status: 'ERROR',
          errorKey: 'error.source.superseded',
          errorMessage: expect.any(String),
          errorParams: null,
        },
      });
    });

    // Spec 065, REQ-13
    it('does not let a SCANNED sibling whose only job is ERROR block the race', async () => {
      prisma.mediaSource.findUnique.mockResolvedValue({
        id: 2,
        status: 'DOWNLOADING',
        movieId: 7,
        episodeId: null,
        seasonId: null,
      });
      prisma.mediaSource.findMany.mockResolvedValue([{ id: 1, status: 'SCANNED', infoHash: 'failed-hash' }]);
      prisma.processJob.findMany.mockResolvedValue([
        {
          id: 10,
          status: 'ERROR',
          progress: 0,
          encodeSpeed: null,
          errorKey: 'error.encode.unexpected',
          errorParams: null,
          errorMessage: 'boom',
          updatedAt: new Date(),
          sourceFile: { mediaSourceId: 1 },
        },
      ]);

      const result = await service.resolveRace(2);

      expect(result.outcome).toBe('WON');
      expect(result.message).toMatch(/^ganador/);
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

      expect(result.outcome).toBe('IGNORED');
      expect(result.message).toMatch(/^ignorado/);
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

      // Spec 022, NFR-6
      expect(prisma.mediaSource.update).not.toHaveBeenCalled();
      expect(result.outcome).toBe('WON');
      expect(result.message).toMatch(/^ganador.*0 pausado/);
    });
  });

  describe('handleTorrentCompleted — REQ-13 one-winner guard', () => {
    // Fault injection: comment out the resolveRace call in
    // handleTorrentCompleted (or move it after the READY-marking
    // transaction) and this case starts asserting a second
    // bull:process job and a status change that must never happen. A
    // late-arriving loser is no longer left untouched — it is written to
    // ERROR/error.source.superseded, but the movie must still never be
    // touched and nothing is enqueued for it.

    // Spec 087, REQ-5 AC-6
    it('records a late-arriving loser as superseded and enqueues nothing when a sibling already reached READY', async () => {
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
      expect(prisma.mediaSource.update).toHaveBeenCalledWith({
        where: { id: 2 },
        data: {
          status: 'ERROR',
          errorKey: 'error.source.superseded',
          errorMessage: expect.any(String),
          errorParams: null,
        },
      });
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

  describe('downloadStart/downloadStop — REQ-7 guarded write', () => {
    // ../plan.md § Approach decision 2: the write must be an `updateMany`
    // guarded on non-terminal statuses in its `where`, never a
    // read-then-write. Fault injection: replace the guarded updateMany with
    // an unconditional `mediaSource.update({ data: { status: 'QUEUED' } })`
    // and this case starts asserting QUEUED for a READY source — the title
    // would then walk backwards from DOWNLOADED to QUEUED on a click that
    // was supposed to be a no-op on an already-finished (seeding) torrent.
    it('downloadStart on a READY source leaves it READY', async () => {
      prisma.mediaSource.findUnique.mockResolvedValue({
        id: 1,
        kind: 'TORRENT_SEARCH',
        status: 'READY',
        infoHash: 'seeding-hash',
        releaseTitle: null,
        movieId: 7,
        seasonId: null,
        episodeId: null,
        movie: { id: 7, title: 'Ya Terminada', users: [{ userId: 'user-1' }] },
        episode: null,
        season: null,
      });
      prisma.movie.findUnique.mockResolvedValue({ title: 'Ya Terminada' });

      const download = await service.downloadStart(1, 'user-1');

      // The guarded updateMany is attempted (never a plain `update`), but
      // its `where` excludes READY, so the Prisma layer would not match any
      // row — modelled here by the mock's default `{ count: 0 }`.
      expect(prisma.mediaSource.updateMany).toHaveBeenCalledWith({
        where: { id: 1, status: { in: ['PENDING', 'QUEUED', 'DOWNLOADING', 'PAUSED'] } },
        data: { status: 'QUEUED' },
      });
      expect(prisma.mediaSource.update).not.toHaveBeenCalled();
      expect(download.status).toBe('DOWNLOADED');
    });

    it('downloadStart on a QUEUED source writes QUEUED (a no-op in value, but exercises the matching branch)', async () => {
      prisma.mediaSource.findUnique.mockResolvedValue({
        id: 2,
        kind: 'TORRENT_SEARCH',
        status: 'PENDING',
        infoHash: 'pending-hash',
        releaseTitle: null,
        movieId: 8,
        seasonId: null,
        episodeId: null,
        movie: { id: 8, title: 'Recien Agregada', users: [{ userId: 'user-1' }] },
        episode: null,
        season: null,
      });
      prisma.movie.findUnique.mockResolvedValue({ title: 'Recien Agregada' });
      prisma.mediaSource.updateMany.mockResolvedValue({ count: 1 });

      const download = await service.downloadStart(2, 'user-1');

      expect(prisma.mediaSource.updateMany).toHaveBeenCalledWith({
        where: { id: 2, status: { in: ['PENDING', 'QUEUED', 'DOWNLOADING', 'PAUSED'] } },
        data: { status: 'QUEUED' },
      });
      expect(download.status).toBe('QUEUED');
    });

    it('downloadStop writes PAUSED on a downloading source', async () => {
      prisma.mediaSource.findUnique.mockResolvedValue({
        id: 3,
        kind: 'TORRENT_SEARCH',
        status: 'DOWNLOADING',
        infoHash: 'downloading-hash',
        releaseTitle: null,
        movieId: 9,
        seasonId: null,
        episodeId: null,
        movie: { id: 9, title: 'Bajando', users: [{ userId: 'user-1' }] },
        episode: null,
        season: null,
      });
      prisma.movie.findUnique.mockResolvedValue({ title: 'Bajando' });
      prisma.mediaSource.updateMany.mockResolvedValue({ count: 1 });

      const download = await service.downloadStop(3, 'user-1');

      expect(prisma.mediaSource.updateMany).toHaveBeenCalledWith({
        where: { id: 3, status: { in: ['PENDING', 'QUEUED', 'DOWNLOADING', 'PAUSED'] } },
        data: { status: 'PAUSED' },
      });
      expect(download.status).toBe('PAUSED');
    });

    it('the write happens after the torrent client call, never before', async () => {
      const order: string[] = [];
      qbittorrent.start.mockImplementation(async () => {
        order.push('client');
      });
      prisma.mediaSource.updateMany.mockImplementation(async () => {
        order.push('db');
        return { count: 1 };
      });
      prisma.mediaSource.findUnique.mockResolvedValue({
        id: 4,
        kind: 'TORRENT_SEARCH',
        status: 'PAUSED',
        infoHash: 'paused-hash',
        releaseTitle: null,
        movieId: 10,
        seasonId: null,
        episodeId: null,
        movie: { id: 10, title: 'Pausada', users: [{ userId: 'user-1' }] },
        episode: null,
        season: null,
      });
      prisma.movie.findUnique.mockResolvedValue({ title: 'Pausada' });

      await service.downloadStart(4, 'user-1');

      expect(order).toEqual(['client', 'db']);
    });
  });

  // 063-downloads-panel-filters: this suite exists because a wrong order
  // (or a dropped sort) renders a valid panel with no error anywhere — the
  // row that just changed sits at the bottom. Fault injection: ignore the
  // job timestamp in byLastActivity and the first case fails.
  describe('movieDownloads/showDownloads — last-activity order', () => {
    const row = (id: number, updatedAt: string) => ({
      id,
      kind: 'TORRENT_SEARCH',
      status: 'SCANNED',
      infoHash: `hash-${id}`,
      releaseTitle: null,
      movieId: 7,
      seasonId: null,
      episodeId: null,
      updatedAt: new Date(updatedAt),
    });

    beforeEach(() => {
      prisma.movie.findFirst.mockResolvedValue({ id: 7, title: 'Orden' });
    });

    it('puts an older source whose encode job just changed above a newer idle source', async () => {
      prisma.mediaSource.findMany.mockResolvedValue([row(2, '2026-09-19T10:00:00Z'), row(1, '2026-09-18T10:00:00Z')]);
      prisma.processJob.findMany.mockResolvedValue([
        { status: 'ENCODING', progress: 10, encodeSpeed: null, updatedAt: new Date('2026-09-19T11:00:00Z'), sourceFile: { mediaSourceId: 1 } },
      ]);

      const downloads = await service.movieDownloads(7, 'user-1');

      expect(downloads.map((d) => d.mediaSourceId)).toEqual([1, 2]);
    });

    it('orders by the source updatedAt, newest first, when there are no jobs', async () => {
      prisma.mediaSource.findMany.mockResolvedValue([row(1, '2026-09-18T10:00:00Z'), row(2, '2026-09-19T10:00:00Z')]);

      const downloads = await service.movieDownloads(7, 'user-1');

      expect(downloads.map((d) => d.mediaSourceId)).toEqual([2, 1]);
    });

    it('breaks an activity tie with the higher source id first', async () => {
      prisma.mediaSource.findMany.mockResolvedValue([row(1, '2026-09-19T10:00:00Z'), row(2, '2026-09-19T10:00:00Z')]);

      const downloads = await service.movieDownloads(7, 'user-1');

      expect(downloads.map((d) => d.mediaSourceId)).toEqual([2, 1]);
    });

    it('showDownloads orders the same way and labels a season row with its number', async () => {
      const show = { id: 9, title: 'Reacher' };
      prisma.show.findFirst.mockResolvedValue(show);
      const base = { kind: 'TORRENT_SEARCH', status: 'SCANNED', infoHash: null, releaseTitle: null, movieId: null };
      prisma.mediaSource.findMany.mockResolvedValue([
        {
          ...base,
          id: 2,
          seasonId: 30,
          episodeId: null,
          updatedAt: new Date('2026-09-19T10:00:00Z'),
          season: { id: 30, seasonNumber: 3, show: { ...show, users: [{ userId: 'user-1' }] } },
          episode: null,
        },
        {
          ...base,
          id: 1,
          seasonId: null,
          episodeId: 55,
          updatedAt: new Date('2026-09-19T11:00:00Z'),
          season: null,
          episode: { episodeNumber: 8, season: { seasonNumber: 3, show: { ...show, users: [{ userId: 'user-1' }] } } },
        },
      ]);

      const downloads = await service.showDownloads(9, 'user-1');

      expect(downloads.map((d) => d.mediaSourceId)).toEqual([1, 2]);
      expect(downloads[0].label).toBe('Reacher S03E08');
      expect(downloads[0].seasonNumber).toBeUndefined();
      expect(downloads[1].label).toBe('Reacher S03');
      expect(downloads[1].seasonNumber).toBe(3);
      expect(downloads.map((d) => d.showTitle)).toEqual(['Reacher', 'Reacher']);
      expect(downloads.map((d) => d.showId)).toEqual([9, 9]);
      expect(downloads.every((d) => d.owned)).toBe(true);
    });
  });

  describe('movieDownloads — ownership fields', () => {
    it('reports owned true and no show on a film row', async () => {
      prisma.movie.findFirst.mockResolvedValue({ id: 7, title: 'Peli' });
      prisma.mediaSource.findMany.mockResolvedValue([
        { id: 1, kind: 'TORRENT_SEARCH', status: 'SCANNED', infoHash: null, releaseTitle: null, movieId: 7, seasonId: null, episodeId: null, updatedAt: new Date(0), movie: { id: 7, title: 'Peli', users: [{ userId: 'user-1' }] } },
      ]);

      const [download] = await service.movieDownloads(7, 'user-1');

      expect(download.owned).toBe(true);
      expect(download.showId).toBeUndefined();
      expect(download.showTitle).toBeUndefined();
    });
  });

  describe('downloads / activeDownloadCount — installation-wide', () => {
    const mine = [{ userId: 'user-1' }];
    const base = { kind: 'TORRENT_SEARCH', releaseTitle: null, updatedAt: new Date(0) };
    const filmSource = (id: number, movieId: number, status: string, users = mine) => ({
      ...base,
      id,
      status,
      infoHash: `hash-${id}`,
      movieId,
      seasonId: null,
      episodeId: null,
      seasonNumber: undefined,
      movie: { id: movieId, title: `Film ${movieId}`, users },
      season: null,
      episode: null,
    });
    const show = { id: 9, title: 'Reacher', users: mine };
    const packSource = (id: number, status: string) => ({
      ...base,
      id,
      status,
      infoHash: `hash-${id}`,
      movieId: null,
      seasonId: 30,
      episodeId: null,
      movie: null,
      season: { seasonNumber: 2, show },
      episode: null,
    });
    const episodeSource = (id: number, status: string) => ({
      ...base,
      id,
      status,
      infoHash: `hash-${id}`,
      movieId: null,
      seasonId: null,
      episodeId: 50 + id,
      movie: null,
      season: null,
      episode: { episodeNumber: id, season: { seasonNumber: 1, show } },
    });

    it('reads owned per caller for the same source', async () => {
      prisma.mediaSource.findMany.mockResolvedValue([filmSource(1, 7, 'DOWNLOADING', [])]);
      const [foreign] = await service.downloads('user-2');
      prisma.mediaSource.findMany.mockResolvedValue([filmSource(1, 7, 'DOWNLOADING', mine)]);
      const [own] = await service.downloads('user-1');

      expect(foreign.owned).toBe(false);
      expect(own.owned).toBe(true);
      expect(prisma.mediaSource.findMany).toHaveBeenCalledWith(expect.not.objectContaining({ where: expect.anything() }));
    });

    it('carries showId and showTitle on a season-pack row', async () => {
      prisma.mediaSource.findMany.mockResolvedValue([packSource(1, 'DOWNLOADING')]);

      const [download] = await service.downloads('user-1');

      expect(download.showId).toBe(9);
      expect(download.showTitle).toBe('Reacher');
      expect(download.seasonNumber).toBe(2);
    });

    it('makes one untagged qbittorrent call and one job query across many titles', async () => {
      prisma.mediaSource.findMany.mockResolvedValue([filmSource(1, 7, 'QUEUED'), filmSource(2, 8, 'QUEUED'), packSource(3, 'QUEUED')]);

      await service.downloads('user-1');

      expect(qbittorrent.info).toHaveBeenCalledTimes(1);
      expect(qbittorrent.info).toHaveBeenCalledWith(undefined);
      expect(prisma.processJob.findMany).toHaveBeenCalledTimes(1);
    });

    it('returns rows with no live fields when the torrent client rejects', async () => {
      prisma.mediaSource.findMany.mockResolvedValue([filmSource(1, 7, 'DOWNLOADING')]);
      qbittorrent.info.mockRejectedValue(new Error('down'));
      jest.spyOn(console, 'error').mockImplementation(() => undefined);

      const [download] = await service.downloads('user-1');

      expect(download.downloadSpeed).toBeUndefined();
      expect(download.downloadProgress).toBeUndefined();
    });

    it('counts three films with two active sources each as 3', async () => {
      prisma.mediaSource.findMany.mockResolvedValue([
        filmSource(1, 1, 'DOWNLOADING'), filmSource(2, 1, 'QUEUED'),
        filmSource(3, 2, 'DOWNLOADING'), filmSource(4, 2, 'QUEUED'),
        filmSource(5, 3, 'DOWNLOADING'), filmSource(6, 3, 'QUEUED'),
      ]);

      expect(await service.activeDownloadCount('user-1')).toBe(3);
    });

    it('counts one show with an active pack and two active episodes as 1', async () => {
      prisma.mediaSource.findMany.mockResolvedValue([packSource(1, 'DOWNLOADING'), episodeSource(2, 'QUEUED'), episodeSource(3, 'DOWNLOADING')]);

      expect(await service.activeDownloadCount('user-1')).toBe(1);
    });

    it('does not count a film whose only source is paused', async () => {
      prisma.mediaSource.findMany.mockResolvedValue([filmSource(1, 7, 'PAUSED')]);

      expect(await service.activeDownloadCount('user-1')).toBe(0);
    });

    it('does not count titles whose sources are only COMPLETED or ERROR', async () => {
      prisma.mediaSource.findMany.mockResolvedValue([filmSource(1, 7, 'SCANNED'), filmSource(2, 8, 'ERROR')]);
      prisma.processJob.findMany.mockResolvedValue([
        { status: 'COMPLETED', progress: 100, encodeSpeed: null, updatedAt: new Date(0), sourceFile: { mediaSourceId: 1 } },
      ]);

      expect(await service.activeDownloadCount('user-1')).toBe(0);
    });
  });

  describe('movieDownloads — job grouping', () => {
    // Spec 043, T003
    it('derives each source from only its own jobs, never a sibling source on the same title', async () => {
      prisma.movie.findFirst.mockResolvedValue({ id: 7, title: 'Dos Fuentes' });
      prisma.mediaSource.findMany.mockResolvedValue([
        { id: 1, kind: 'TORRENT_SEARCH', status: 'SCANNED', infoHash: 'hash-1', releaseTitle: null, movieId: 7, seasonId: null, episodeId: null, updatedAt: new Date(0) },
        { id: 2, kind: 'TORRENT_SEARCH', status: 'SCANNED', infoHash: 'hash-2', releaseTitle: null, movieId: 7, seasonId: null, episodeId: null, updatedAt: new Date(0) },
      ]);
      // Source 1's job is COMPLETED; source 2's job is still ENCODING.
      // Pooling them would make either row report the other's status.
      prisma.processJob.findMany.mockResolvedValue([
        { status: 'COMPLETED', progress: 100, sourceFile: { mediaSourceId: 1 } },
        { status: 'ENCODING', progress: 30, sourceFile: { mediaSourceId: 2 } },
      ]);
      qbittorrent.info.mockResolvedValue([]);

      const downloads = await service.movieDownloads(7, 'user-1');

      const first = downloads.find((d) => d.mediaSourceId === 1);
      const second = downloads.find((d) => d.mediaSourceId === 2);

      expect(first!.status).toBe('COMPLETED');
      expect(first!.encodeProgress).toBe(100);
      expect(second!.status).toBe('ENCODING');
      expect(second!.encodeProgress).toBe(30);
    });
  });

  // 053-downloads-panel-repair: this suite exists because an indexer-sourced
  // MediaSource.infoHash is stored uppercase while qBittorrent reports (and
  // is keyed here) lowercase — a raw `live.get(source.infoHash)` misses the
  // join silently: no error anywhere, the row just renders with
  // downloadProgress/downloadSpeed null and its last-written status, next to
  // a magnet-sourced row that joins fine. MariaDB's case-insensitive
  // collation hides this from every SQL check, which is why it has to be
  // pinned here, in-memory. Both movieDownloads and showDownloads are
  // covered — they are structural twins, and fixing one without the other
  // is the named risk in ../plan.md. Fault injection: revert liveFor's
  // `.toLowerCase()` (on either side) and both cases below start asserting
  // a null downloadProgress/downloadSpeed and the stale DB status.
  describe('movieDownloads/showDownloads — case-insensitive infoHash join (REQ-2/REQ-4)', () => {
    it('movieDownloads joins an uppercase-stored infoHash to qBittorrent\'s lowercase report', async () => {
      prisma.movie.findFirst.mockResolvedValue({ id: 7, title: 'Mayúscula' });
      prisma.mediaSource.findMany.mockResolvedValue([
        {
          id: 1,
          kind: 'TORRENT_SEARCH',
          status: 'QUEUED',
          infoHash: 'ABCDEF0123456789ABCDEF0123456789ABCDEF01',
          releaseTitle: null,
          movieId: 7,
          seasonId: null,
          episodeId: null,
        },
      ]);
      qbittorrent.info.mockResolvedValue([
        {
          hash: 'abcdef0123456789abcdef0123456789abcdef01',
          state: 'DOWNLOADING',
          rawState: 'downloading',
          progress: 0.42,
          dlspeed: 1234,
        },
      ]);

      const [download] = await service.movieDownloads(7, 'user-1');

      expect(download.downloadProgress).toBe(42);
      expect(download.downloadSpeed).toBe(1234);
      expect(download.status).toBe('DOWNLOADING');
    });

    it('showDownloads joins an uppercase-stored infoHash to qBittorrent\'s lowercase report', async () => {
      const show = { id: 9, title: 'Serie Mayúscula', users: [{ userId: 'user-1' }] };
      prisma.show.findFirst.mockResolvedValue(show);
      prisma.mediaSource.findMany.mockResolvedValue([
        {
          id: 2,
          kind: 'TORRENT_SEARCH',
          status: 'QUEUED',
          infoHash: 'FEDCBA9876543210FEDCBA9876543210FEDCBA98',
          releaseTitle: null,
          movieId: null,
          seasonId: null,
          episodeId: 55,
          episode: { episodeNumber: 3, season: { seasonNumber: 1, show } },
          season: null,
        },
      ]);
      qbittorrent.info.mockResolvedValue([
        {
          hash: 'fedcba9876543210fedcba9876543210fedcba98',
          state: 'DOWNLOADING',
          rawState: 'downloading',
          progress: 0.75,
          dlspeed: 5678,
        },
      ]);

      const [download] = await service.showDownloads(9, 'user-1');

      expect(download.downloadProgress).toBe(75);
      expect(download.downloadSpeed).toBe(5678);
      expect(download.status).toBe('DOWNLOADING');
    });
  });

  // 047-source-deletion: this suite exists because a wrong step order here
  // reports `true` while leaving real work behind — a torrent still
  // downloading in qBittorrent, an encode still running in the worker, or a
  // folder still on disk — with no error anywhere to say so (../plan.md §
  // Risks). Every case below is a fault-injection case: reordering the
  // steps in `downloadDelete` (per `api/plan.md` § Steps 6) makes at least
  // one of them fail.
  describe('downloadDelete — deletion orchestration', () => {
    function ownedTorrentSource(overrides: Record<string, unknown> = {}) {
      return {
        id: 1,
        kind: 'TORRENT_SEARCH',
        status: 'DOWNLOADING',
        infoHash: 'hash-1',
        releaseTitle: null,
        downloadPath: '/media/downloads/abc123',
        movieId: 7,
        seasonId: null,
        episodeId: null,
        movie: { id: 7, users: [{ userId: 'user-1' }] },
        episode: null,
        season: null,
        ...overrides,
      };
    }

    beforeEach(() => {
      prisma.movie.findUnique.mockResolvedValue({ filePath: null, mediaSources: [], processJobs: [] });
    });

    it('accepts an upload with no infoHash instead of refusing it (REQ-1)', async () => {
      prisma.mediaSource.findUnique.mockResolvedValue(
        ownedTorrentSource({ infoHash: null, downloadPath: null, kind: 'LOCAL_FILE' }),
      );

      const result = await service.downloadDelete(1, 'user-1');

      expect(result).toBe(true);
      expect(qbittorrent.remove).not.toHaveBeenCalled();
      expect(prisma.mediaSource.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    });

    it('calls the torrent client before any Prisma delete or any disk removal, and a rejection leaves everything untouched', async () => {
      prisma.mediaSource.findUnique.mockResolvedValue(ownedTorrentSource());
      prisma.processJob.findMany.mockResolvedValue([{ id: 101 }]);
      qbittorrent.remove.mockRejectedValue(new Error('qBittorrent unreachable'));

      await expect(service.downloadDelete(1, 'user-1')).rejects.toThrow();

      expect(prisma.mediaSource.delete).not.toHaveBeenCalled();
      expect(rm).not.toHaveBeenCalled();
      expect(rmdir).not.toHaveBeenCalled();
      expect(encodeQueue.publishCancel).not.toHaveBeenCalled();
      expect(encodeQueue.removeEncode).not.toHaveBeenCalled();
      expect(queue.removeSourceReady).not.toHaveBeenCalled();
    });

    it('runs every step in order: torrent client, then queue withdrawal, then disk, then the row', async () => {
      const order: string[] = [];
      prisma.mediaSource.findUnique.mockResolvedValue(ownedTorrentSource());
      prisma.processJob.findMany.mockResolvedValue([{ id: 101 }]);
      qbittorrent.remove.mockImplementation(async () => {
        order.push('torrent-client');
      });
      encodeQueue.publishCancel.mockImplementation(async () => {
        order.push('publish-cancel');
      });
      encodeQueue.removeEncode.mockImplementation(async () => {
        order.push('remove-encode');
      });
      queue.removeSourceReady.mockImplementation(async () => {
        order.push('remove-source-ready');
      });
      (rm as jest.Mock).mockImplementation(async () => {
        order.push('rm');
      });
      prisma.mediaSource.delete.mockImplementation(async () => {
        order.push('db-delete');
        return {};
      });

      await service.downloadDelete(1, 'user-1');

      expect(order).toEqual([
        'torrent-client',
        'publish-cancel',
        'remove-encode',
        'remove-source-ready',
        'rm',
        'db-delete',
      ]);
    });

    it('cancels and withdraws exactly one entry per ProcessJob of this source, none belonging to another source', async () => {
      prisma.mediaSource.findUnique.mockResolvedValue(ownedTorrentSource());
      prisma.processJob.findMany.mockResolvedValue([{ id: 101 }, { id: 102 }, { id: 103 }]);

      await service.downloadDelete(1, 'user-1');

      expect(prisma.processJob.findMany).toHaveBeenCalledWith({
        where: { sourceFile: { mediaSourceId: 1 } },
        select: { id: true },
      });
      expect(encodeQueue.publishCancel).toHaveBeenCalledTimes(3);
      expect(encodeQueue.removeEncode).toHaveBeenCalledTimes(3);
      for (const id of [101, 102, 103]) {
        expect(encodeQueue.publishCancel).toHaveBeenCalledWith(id);
        expect(encodeQueue.removeEncode).toHaveBeenCalledWith(id);
      }
      expect(encodeQueue.publishCancel).not.toHaveBeenCalledWith(999);
      expect(encodeQueue.removeEncode).not.toHaveBeenCalledWith(999);
    });

    it('withdraws the process-ready entry exactly once', async () => {
      prisma.mediaSource.findUnique.mockResolvedValue(ownedTorrentSource());

      await service.downloadDelete(1, 'user-1');

      expect(queue.removeSourceReady).toHaveBeenCalledTimes(1);
      expect(queue.removeSourceReady).toHaveBeenCalledWith(1);
    });

    it('deletes nothing on disk for a downloadPath outside the downloads root, but still deletes the row (AC-10)', async () => {
      prisma.mediaSource.findUnique.mockResolvedValue(ownedTorrentSource({ downloadPath: '/etc' }));
      mediaRoots.isInsideRoot.mockResolvedValue(false);

      const result = await service.downloadDelete(1, 'user-1');

      expect(result).toBe(true);
      expect(rm).not.toHaveBeenCalled();
      expect(rmdir).not.toHaveBeenCalled();
      expect(prisma.mediaSource.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    });
  });
  // 065-pipeline-error-resume: this suite exists because a resume that
  // enqueues without first withdrawing the retained BullMQ id is a silent
  // no-op (the job never runs again, nothing logs it), and one that flips a
  // row out of ERROR before the enqueue succeeds leaves it wedged in
  // WAITING/READY forever. Fault injection: swap removeEncode/addEncode and
  // the ordering cases fail; drop the restore in the catch and the
  // enqueue-failure cases fail.
  // This block exists because unwinding a whole title (067) fails silently in
  // three ways: a source shape missed when collecting a series' sources
  // (its torrent keeps seeding forever, invisible once the row is gone), a
  // dropped publishCancel (the worker keeps encoding into nothing), and a
  // torrent removal split per source (a rejection halfway leaves some
  // torrents gone and the title still listed). It also pins that a residue
  // failure on one source never stops the others.
  describe('unwindSourcesForTitle — title-scoped unwind', () => {
    const src = (id: number, infoHash: string | null, extra: object = {}) => ({
      id,
      infoHash,
      downloadPath: `/media/downloads/s${id}`,
      kind: 'TORRENT_SEARCH',
      movieId: null,
      seasonId: null,
      episodeId: null,
      ...extra,
    });

    it('sends every hash of a movie/season/episode-shaped set in ONE remove() call, then unwinds each source in order', async () => {
      prisma.mediaSource.findMany.mockResolvedValue([
        src(1, 'aaa', { movieId: 9 }),
        src(2, 'bbb', { seasonId: 4 }),
        src(3, 'ccc', { episodeId: 5 }),
        src(4, null),
      ]);
      prisma.processJob.findMany.mockImplementation(async ({ where }: { where: { sourceFile: { mediaSourceId: number } } }) =>
        where.sourceFile.mediaSourceId === 2 ? [{ id: 20 }] : [],
      );

      await service.unwindSourcesForTitle({ showId: 3 });

      expect(qbittorrent.remove).toHaveBeenCalledTimes(1);
      expect(qbittorrent.remove).toHaveBeenCalledWith(['aaa', 'bbb', 'ccc'], true);
      expect(encodeQueue.publishCancel).toHaveBeenCalledWith(20);
      expect(encodeQueue.removeEncode).toHaveBeenCalledWith(20);
      expect(queue.removeSourceReady.mock.calls.map((c) => c[0])).toEqual([1, 2, 3, 4]);
      expect(prisma.mediaSource.delete.mock.calls.map((c) => c[0].where.id)).toEqual([1, 2, 3, 4]);
      expect(rm).toHaveBeenCalledTimes(4);
      // The series query must reach both season packs and episode singles.
      const where = prisma.mediaSource.findMany.mock.calls[0][0].where;
      expect(JSON.stringify(where)).toContain('"season":{"showId":3}');
      expect(JSON.stringify(where)).toContain('"episode":{"season":{"showId":3}}');
    });

    it('leaves the database, disk and queues untouched when the torrent client rejects', async () => {
      prisma.mediaSource.findMany.mockResolvedValue([src(1, 'aaa', { movieId: 9 })]);
      qbittorrent.remove.mockRejectedValue(new Error('down'));

      await expect(service.unwindSourcesForTitle({ movieId: 9 })).rejects.toBeDefined();

      expect(prisma.mediaSource.delete).not.toHaveBeenCalled();
      expect(rm).not.toHaveBeenCalled();
      expect(encodeQueue.publishCancel).not.toHaveBeenCalled();
      expect(queue.removeSourceReady).not.toHaveBeenCalled();
    });

    it('keeps unwinding the remaining sources when residue deletion throws on one', async () => {
      prisma.mediaSource.findMany.mockResolvedValue([src(1, 'aaa', { movieId: 9 }), src(2, 'bbb', { movieId: 9 })]);
      (rm as jest.Mock).mockRejectedValueOnce(new Error('EACCES'));
      const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

      await expect(service.unwindSourcesForTitle({ movieId: 9 })).resolves.toBeUndefined();

      spy.mockRestore();
      expect(prisma.mediaSource.delete).toHaveBeenCalledTimes(2);
      expect(rm).toHaveBeenCalledTimes(2);
    });

    it('does not call the torrent client for a title with only uploads', async () => {
      prisma.mediaSource.findMany.mockResolvedValue([src(1, null, { movieId: 9, kind: 'LOCAL_FILE' })]);
      await service.unwindSourcesForTitle({ movieId: 9 });
      expect(qbittorrent.remove).not.toHaveBeenCalled();
      expect(prisma.mediaSource.delete).toHaveBeenCalledTimes(1);
    });
  });

  describe('downloadStart on an ERROR source — resume', () => {
    const at = new Date('2026-09-19T10:00:00Z');
    const sourceRow = (over: Record<string, unknown> = {}) => ({
      id: 1,
      kind: 'TORRENT_SEARCH',
      status: 'SCANNED',
      infoHash: 'hash-1',
      releaseTitle: null,
      downloadPath: '/downloads/x',
      errorKey: null,
      errorParams: null,
      errorMessage: null,
      updatedAt: at,
      movieId: 7,
      seasonId: null,
      episodeId: null,
      movie: { id: 7, title: 'Film', users: [{ userId: 'user-1' }] },
      episode: null,
      season: null,
      ...over,
    });
    const jobRow = (id: number, over: Record<string, unknown> = {}) => ({
      id,
      status: 'ERROR',
      progress: 40,
      encodeSpeed: 1.2,
      errorKey: 'error.encode.unexpected',
      errorParams: '{"detail":"boom"}',
      errorMessage: 'boom',
      updatedAt: at,
      sourceFile: { mediaSourceId: 1 },
      ...over,
    });
    const jobWrites = () => prisma.processJob.updateMany.mock.calls.map((c) => c[0]);

    beforeEach(() => {
      prisma.processJob.updateMany.mockResolvedValue({ count: 1 });
      prisma.movie.findUnique.mockResolvedValue({ filePath: null, mediaSources: [], processJobs: [] });
    });

    it('withdraws each encode before re-adding it and ends QUEUED', async () => {
      const order: string[] = [];
      encodeQueue.removeEncode.mockImplementation(async (id: number) => void order.push(`remove:${id}`));
      encodeQueue.addEncode.mockImplementation(async ({ processJobId }: { processJobId: number }) => {
        order.push(`add:${processJobId}`);
      });
      prisma.mediaSource.findUnique.mockResolvedValue(sourceRow());
      prisma.processJob.findMany.mockResolvedValue([jobRow(11), jobRow(12)]);

      await service.downloadStart(1, 'user-1');

      expect(order).toEqual(['remove:11', 'add:11', 'remove:12', 'add:12']);
      const writes = jobWrites();
      expect(writes[0].data).toMatchObject({ status: 'WAITING', progress: 0, encodeSpeed: null, recoveryCount: 0, errorKey: null });
      expect(writes[writes.length - 1]).toEqual({ where: { id: { in: [11, 12] }, status: 'WAITING' }, data: { status: 'QUEUED' } });
    });

    it('withdraws the scan entry before re-adding it', async () => {
      const order: string[] = [];
      queue.removeSourceReady.mockImplementation(async () => void order.push('remove'));
      queue.addSourceReady.mockImplementation(async () => void order.push('add'));
      // The first findUnique is the ERROR lookup downloadStart/resumeErroredSource
      // reads; resolveRace re-reads the row afterward, by which point the
      // guarded updateMany below has already flipped it to READY in the real
      // DB — a static mock would otherwise make resolveRace see a source
      // still ERROR and (correctly, per this feature's fix) refuse to treat it
      // as a winner, which is a mocking gap, not a behaviour this test means
      // to cover.
      prisma.mediaSource.findUnique
        .mockResolvedValueOnce(
          sourceRow({ status: 'ERROR', errorKey: 'error.source.scan_no_video', errorMessage: 'none' }),
        )
        .mockResolvedValue(sourceRow({ status: 'READY', errorKey: null, errorMessage: null }));
      prisma.mediaSource.updateMany.mockResolvedValue({ count: 1 });

      await service.downloadStart(1, 'user-1');

      expect(prisma.mediaSource.updateMany).toHaveBeenCalledWith({ where: { id: 1, status: 'ERROR' }, data: { status: 'READY' } });
      expect(order).toEqual(['remove', 'add']);
    });

    it('restores the jobs to ERROR with their original error when the encode enqueue fails', async () => {
      encodeQueue.addEncode.mockRejectedValue(new Error('redis down'));
      prisma.mediaSource.findUnique.mockResolvedValue(sourceRow());
      prisma.processJob.findMany.mockResolvedValue([jobRow(11)]);

      await expect(service.downloadStart(1, 'user-1')).rejects.toMatchObject({
        response: { i18n: { key: 'error.download.retry_enqueue_failed' } },
      });

      expect(jobWrites()).toContainEqual({
        where: { id: 11, status: 'WAITING' },
        data: { status: 'ERROR', errorKey: 'error.encode.unexpected', errorParams: '{"detail":"boom"}', errorMessage: 'boom' },
      });
      expect(jobWrites()).not.toContainEqual(expect.objectContaining({ data: { status: 'QUEUED' } }));
    });

    it('restores the source to ERROR when the scan enqueue fails', async () => {
      queue.addSourceReady.mockRejectedValue(new Error('redis down'));
      // Same mocking gap as the previous case: resolveRace's own re-read must
      // see the row the guarded updateMany below already flipped to READY.
      prisma.mediaSource.findUnique
        .mockResolvedValueOnce(
          sourceRow({ status: 'ERROR', errorKey: 'error.source.scan_no_video', errorMessage: 'none' }),
        )
        .mockResolvedValue(sourceRow({ status: 'READY', errorKey: null, errorMessage: null }));
      prisma.mediaSource.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.downloadStart(1, 'user-1')).rejects.toMatchObject({
        response: { i18n: { key: 'error.download.retry_enqueue_failed' } },
      });

      expect(prisma.mediaSource.updateMany).toHaveBeenCalledWith({ where: { id: 1, status: 'READY' }, data: { status: 'ERROR' } });
    });

    it('enqueues nothing when the guarded write matched no row', async () => {
      prisma.processJob.updateMany.mockResolvedValue({ count: 0 });
      prisma.mediaSource.findUnique.mockResolvedValue(sourceRow());
      prisma.processJob.findMany.mockResolvedValue([jobRow(11)]);

      await service.downloadStart(1, 'user-1');

      expect(encodeQueue.removeEncode).not.toHaveBeenCalled();
      expect(encodeQueue.addEncode).not.toHaveBeenCalled();
    });

    it.each([
      ['error.source.replaced', 'error.download.retry_replaced', 409],
      ['error.source.no_download_path', 'error.download.retry_unavailable', 400],
    ])('refuses a %s source with %s before any write', async (errorKey, expected, status) => {
      prisma.mediaSource.findUnique.mockResolvedValue(sourceRow({ status: 'ERROR', errorKey, errorMessage: 'x' }));

      await expect(service.downloadStart(1, 'user-1')).rejects.toMatchObject({
        response: { i18n: { key: expected } },
        status,
      });

      expect(prisma.mediaSource.updateMany).not.toHaveBeenCalled();
      expect(prisma.processJob.updateMany).not.toHaveBeenCalled();
      expect(qbittorrent.start).not.toHaveBeenCalled();
    });

    it('refuses with retry_superseded when a sibling already won, before any write', async () => {
      prisma.mediaSource.findUnique.mockResolvedValue(
        sourceRow({ status: 'ERROR', errorKey: 'error.source.scan_no_video', errorMessage: 'none' }),
      );
      prisma.mediaSource.findMany.mockResolvedValue([
        { id: 2, status: 'READY', movieId: 7, seasonId: null, episodeId: null },
      ]);

      await expect(service.downloadStart(1, 'user-1')).rejects.toMatchObject({
        response: { i18n: { key: 'error.download.retry_superseded' } },
        status: 409,
      });

      expect(prisma.mediaSource.updateMany).not.toHaveBeenCalled();
    });

    it('still refuses a non-ERROR upload with not_a_torrent', async () => {
      prisma.mediaSource.findUnique.mockResolvedValue(sourceRow({ kind: 'LOCAL_FILE', infoHash: null, status: 'READY' }));

      await expect(service.downloadStart(1, 'user-1')).rejects.toMatchObject({
        response: { i18n: { key: 'error.download.not_a_torrent' } },
      });
      expect(qbittorrent.start).not.toHaveBeenCalled();
    });
  });

  // Spec 087, REQ-2 REQ-3 REQ-9: this suite exists because a force-replacement that fails to tell
  // a delivered sibling from one still working either reintroduces the stall described in
  // spec.md's § Context & Goal (a target never offered the warning, so the pipeline never
  // demotes the stale source and the replacement sits DOWNLOADING forever) or kills a sibling
  // download in flight with no error anywhere, the collateral-damage regression this feature forbids.
  describe('hasDeliveredSource / demoteDeliveredSources', () => {
    const jobRow = (id: number, mediaSourceId: number, status: string, over: Record<string, unknown> = {}) => ({
      id,
      status,
      progress: 100,
      encodeSpeed: null,
      errorKey: null,
      errorParams: null,
      errorMessage: null,
      updatedAt: new Date('2026-10-01T00:00:00Z'),
      sourceFile: { mediaSourceId },
      ...over,
    });

    describe('hasDeliveredSource', () => {
      it('is false when the target holds no SCANNED source', async () => {
        prisma.mediaSource.findMany.mockResolvedValue([]);

        await expect(service.hasDeliveredSource({ movieId: 7 })).resolves.toBe(false);
        expect(prisma.processJob.findMany).not.toHaveBeenCalled();
      });

      it('is true when a SCANNED source has a COMPLETED job and none active', async () => {
        prisma.mediaSource.findMany.mockResolvedValue([{ id: 1 }]);
        prisma.processJob.findMany.mockResolvedValue([jobRow(11, 1, 'COMPLETED')]);

        await expect(service.hasDeliveredSource({ episodeId: 5 })).resolves.toBe(true);
        expect(prisma.mediaSource.findMany).toHaveBeenCalledWith({
          where: { episodeId: 5, status: 'SCANNED' },
          select: { id: true },
        });
      });

      it('is false when the SCANNED source still has an ENCODING job — a download in flight is not a delivery', async () => {
        prisma.mediaSource.findMany.mockResolvedValue([{ id: 1 }]);
        prisma.processJob.findMany.mockResolvedValue([jobRow(11, 1, 'ENCODING')]);

        await expect(service.hasDeliveredSource({ seasonId: 3 })).resolves.toBe(false);
      });
    });

    describe('demoteDeliveredSources', () => {
      it('demotes only the delivered source, closing none of its jobs since none are active', async () => {
        prisma.mediaSource.findMany.mockResolvedValue([{ id: 1 }]);
        prisma.processJob.findMany.mockResolvedValue([jobRow(11, 1, 'COMPLETED')]);
        prisma.processJob.updateMany.mockResolvedValue({ count: 0 });

        await expect(service.demoteDeliveredSources({ movieId: 7 }, 'force-replace')).resolves.toBe(1);

        expect(prisma.mediaSource.updateMany).toHaveBeenCalledWith({
          where: { id: { in: [1] } },
          data: expect.objectContaining({ status: 'ERROR', errorKey: 'error.source.replaced' }),
        });
        expect(prisma.processJob.updateMany).toHaveBeenCalledWith({
          where: { sourceFile: { mediaSourceId: { in: [1] } }, status: { in: ['WAITING', 'QUEUED', 'ENCODING'] } },
          data: expect.objectContaining({ status: 'ERROR', errorKey: 'error.source.replaced' }),
        });
      });

      it('does not demote a SCANNED sibling whose encode is still active, and writes nothing', async () => {
        prisma.mediaSource.findMany.mockResolvedValue([{ id: 1 }]);
        prisma.processJob.findMany.mockResolvedValue([jobRow(11, 1, 'ENCODING')]);

        await expect(service.demoteDeliveredSources({ movieId: 7 }, 'force-replace')).resolves.toBe(0);

        expect(prisma.mediaSource.updateMany).not.toHaveBeenCalled();
        expect(prisma.processJob.updateMany).not.toHaveBeenCalled();
      });

      it('leaves a non-SCANNED sibling (e.g. DOWNLOADING at 50%) untouched — it is never selected at all', async () => {
        prisma.mediaSource.findMany.mockResolvedValue([]);

        await expect(service.demoteDeliveredSources({ episodeId: 5 }, 'force-replace')).resolves.toBe(0);

        expect(prisma.mediaSource.findMany).toHaveBeenCalledWith({
          where: { episodeId: 5, status: 'SCANNED' },
          select: { id: true },
        });
        expect(prisma.mediaSource.updateMany).not.toHaveBeenCalled();
      });

      it('writes no Movie/Episode/Season column — only MediaSource and ProcessJob', async () => {
        prisma.mediaSource.findMany.mockResolvedValue([{ id: 1 }]);
        prisma.processJob.findMany.mockResolvedValue([jobRow(11, 1, 'COMPLETED')]);

        await service.demoteDeliveredSources({ movieId: 7 }, 'force-replace');

        expect(prisma.movie.update).not.toHaveBeenCalled();
        expect(prisma.episode.update).not.toHaveBeenCalled();
      });
    });
  });

  // Spec 087, REQ-5 REQ-6: this suite exists because the arbiter used to
  // answer a superseded source with a log line and nothing else — the
  // source never left its pre-arbitration status, so a film whose
  // replacement reached 100% while a sibling had already won sat frozen in
  // DOWNLOADING with no error anywhere (spec.md § Context & Goal). It also
  // guards the one regression this feature must not introduce: a WON
  // outcome must still pause its in-flight losers exactly as 022 specifies.
  describe('resolveRace — outcome typing and the superseded write (REQ-5/REQ-6)', () => {
    it('comes back SUPERSEDED, writes ERROR/error.source.superseded and stops the torrent for its own hash', async () => {
      prisma.mediaSource.findUnique.mockResolvedValue({
        id: 9,
        status: 'DOWNLOADING',
        infoHash: 'superseded-hash',
        movieId: 7,
        episodeId: null,
        seasonId: null,
      });
      prisma.mediaSource.findMany.mockResolvedValue([
        { id: 1, status: 'SCANNED', infoHash: 'winner-hash' },
      ]);
      prisma.processJob.findMany.mockResolvedValue([
        {
          id: 20,
          status: 'COMPLETED',
          progress: 100,
          encodeSpeed: null,
          errorKey: null,
          errorParams: null,
          errorMessage: null,
          updatedAt: new Date(),
          sourceFile: { mediaSourceId: 1 },
        },
      ]);

      const result = await service.resolveRace(9);

      expect(result).toEqual({ outcome: 'SUPERSEDED', message: expect.stringContaining('ignorado') });
      expect(qbittorrent.stop).toHaveBeenCalledWith('superseded-hash');
      expect(prisma.mediaSource.update).toHaveBeenCalledWith({
        where: { id: 9 },
        data: {
          status: 'ERROR',
          errorKey: 'error.source.superseded',
          errorMessage: expect.any(String),
          errorParams: null,
        },
      });
    });

    it('still comes back SUPERSEDED and records the loss when qbittorrent.stop throws', async () => {
      prisma.mediaSource.findUnique.mockResolvedValue({
        id: 9,
        status: 'DOWNLOADING',
        infoHash: 'superseded-hash',
        movieId: 7,
        episodeId: null,
        seasonId: null,
      });
      prisma.mediaSource.findMany.mockResolvedValue([
        { id: 1, status: 'READY', infoHash: 'winner-hash' },
      ]);
      qbittorrent.stop.mockRejectedValueOnce(new Error('qBittorrent unreachable'));
      jest.spyOn(console, 'error').mockImplementation(() => undefined);

      await expect(service.resolveRace(9)).resolves.toEqual({
        outcome: 'SUPERSEDED',
        message: expect.any(String),
      });
      expect(prisma.mediaSource.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 9 }, data: expect.objectContaining({ status: 'ERROR' }) }),
      );
    });

    it('records a superseded source with no infoHash as a loss without calling stop', async () => {
      prisma.mediaSource.findUnique.mockResolvedValue({
        id: 9,
        status: 'DOWNLOADING',
        infoHash: null,
        movieId: 7,
        episodeId: null,
        seasonId: null,
      });
      prisma.mediaSource.findMany.mockResolvedValue([
        { id: 1, status: 'READY', infoHash: 'winner-hash' },
      ]);

      const result = await service.resolveRace(9);

      expect(result.outcome).toBe('SUPERSEDED');
      expect(qbittorrent.stop).not.toHaveBeenCalled();
      expect(prisma.mediaSource.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 9 }, data: expect.objectContaining({ status: 'ERROR' }) }),
      );
    });

    it('a WON outcome still pauses every in-flight loser, unaffected by the SUPERSEDED branch', async () => {
      prisma.mediaSource.findUnique.mockResolvedValue({
        id: 1,
        status: 'DOWNLOADING',
        infoHash: 'winner-hash',
        movieId: 7,
        episodeId: null,
        seasonId: null,
      });
      prisma.mediaSource.findMany.mockResolvedValue([
        { id: 2, status: 'DOWNLOADING', infoHash: 'loser-hash' },
      ]);

      const result = await service.resolveRace(1);

      expect(result.outcome).toBe('WON');
      expect(qbittorrent.stop).toHaveBeenCalledWith('loser-hash');
      expect(prisma.mediaSource.update).toHaveBeenCalledWith({ where: { id: 2 }, data: { status: 'PAUSED' } });
      // The winner itself is never written by resolveRace.
      expect(prisma.mediaSource.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 1 } }),
      );
    });
  });
});
