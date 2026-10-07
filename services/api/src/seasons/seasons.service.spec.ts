import { Test, TestingModule } from '@nestjs/testing';
import { SeasonsService } from './seasons.service';
import { PrismaService } from '@/prisma/prisma.service';
import { QbittorrentClient, TorrentClientError } from '@/clients/torrent/client';
import { DownloadsService } from '@/downloads/downloads.service';
import { SettingsService } from '@/settings/settings.service';
import { MediaRootsService } from '@/media-roots/media-roots.service';
import { ProcessQueueService } from '@/queue/process-queue.service';
import { SessionService } from '@/uploads/session.service';
import { UploadsService } from '@/uploads/uploads.service';
import { AttachSourceService } from '@/acquisition/attach-source.service';
import { TitleStatusService } from '@/title-status/title-status.service';
import { resolveInfoHash } from '@/clients/indexer/resolve-info-hash';
import { mkdtemp, mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

jest.mock('@/clients/indexer/resolve-info-hash');
jest.mock('@tus/server', () => ({ Server: class {} }));
jest.mock('@tus/file-store', () => ({ FileStore: class {} }));
const mockResolveInfoHash = resolveInfoHash as jest.MockedFunction<typeof resolveInfoHash>;

// This suite mirrors episodes.service.spec.ts's central concern one relation
// shallower: a season-pack acquisition is the entry point Spec 013, REQ-14
// needs to exercise the rest of the pipeline at all, so
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
//    season with no active source and no replacement, silently;
//  - attaching a torrent whose infoHash is already this season's own source
//    (060-duplicate-torrent-add) re-adds it through a different URL and
//    silently re-points downloadPath at an empty folder, resets a finished
//    torrent to QUEUED with no completion notice ever coming, or leaves a
//    stopped torrent stopped under a QUEUED row — every one a success
//    response with nothing in any log until the scan finds no video.
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
    episode: {
      count: jest.Mock;
    };
  };
  let qbittorrent: { add: jest.Mock; info: jest.Mock; start: jest.Mock };
  let downloads: {
    handleTorrentCompleted: jest.Mock;
    resolveRace: jest.Mock;
    hasDeliveredSource: jest.Mock;
    demoteDeliveredSources: jest.Mock;
  };
  let mediaRoots: { resolveFromRoot: jest.Mock };
  let queue: { addSourceReady: jest.Mock };
  let sessions: { findOpenSeasonSession: jest.Mock };
  let uploads: { demoteSupersededSources: jest.Mock };
  let titleStatus: { recomputeSeason: jest.Mock };

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
      episode: {
        count: jest.fn(),
      },
    };
    qbittorrent = { add: jest.fn(), info: jest.fn(), start: jest.fn() };
    downloads = {
      handleTorrentCompleted: jest.fn().mockResolvedValue('ok'),
      resolveRace: jest.fn(),
      hasDeliveredSource: jest.fn().mockResolvedValue(false),
      demoteDeliveredSources: jest.fn().mockResolvedValue(0),
    };
    mediaRoots = { resolveFromRoot: jest.fn().mockResolvedValue('/tmp') };
    queue = { addSourceReady: jest.fn() };
    sessions = { findOpenSeasonSession: jest.fn() };
    uploads = { demoteSupersededSources: jest.fn() };
    titleStatus = { recomputeSeason: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SeasonsService,
        AttachSourceService,
        { provide: PrismaService, useValue: prisma },
        { provide: QbittorrentClient, useValue: qbittorrent },
        { provide: DownloadsService, useValue: downloads },
        { provide: SettingsService, useValue: { getMap: jest.fn().mockResolvedValue({}) } },
        { provide: MediaRootsService, useValue: mediaRoots },
        { provide: ProcessQueueService, useValue: queue },
        { provide: SessionService, useValue: sessions },
        { provide: UploadsService, useValue: uploads },
        { provide: TitleStatusService, useValue: titleStatus },
      ],
    }).compile();

    service = module.get<SeasonsService>(SeasonsService);
    mockResolveInfoHash.mockReset();
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

  describe('addTorrentToSeason', () => {
    const validInput = {
      infoHash: 'abc123def456abc123def456abc123def456abc',
      urls: ['https://indexer.example/download/123'],
      releaseTitle: 'Reacher S02 1080p',
      force: false,
    };

    // Spec 059, AC-4
    it('propagates a resolveInfoHash failure without calling qbittorrent.add or writing a MediaSource', async () => {
      mockResolveInfoHash.mockRejectedValue(new Error('No se pudo determinar el infoHash de este release'));

      await expect(
        service.addTorrentToSeason(42, { ...validInput, infoHash: null }, 'user-1'),
      ).rejects.toThrow('No se pudo determinar el infoHash de este release');

      expect(qbittorrent.add).not.toHaveBeenCalled();
      expect(prisma.mediaSource.create).not.toHaveBeenCalled();
      expect(prisma.mediaSource.update).not.toHaveBeenCalled();
      expect(prisma.season.findFirst).not.toHaveBeenCalled();
    });

    it('creates the source with the supplied infoHash, seasonId and kind TORRENT_SEARCH', async () => {
      prisma.season.findFirst.mockResolvedValue(season);
      prisma.mediaSource.findFirst.mockResolvedValue(null); // no active source
      prisma.mediaSource.findUnique.mockResolvedValue(null); // infoHash unused
      qbittorrent.add.mockResolvedValue('/downloads/reacher-s02');
      prisma.mediaSource.create.mockResolvedValue({ id: 100, seasonId: 42 });
      prisma.season.findUniqueOrThrow.mockResolvedValue({ ...season, episodes: [] });

      await service.addTorrentToSeason(42, validInput, 'user-1');

      // A supplied infoHash must not go through resolution at all.
      expect(mockResolveInfoHash).not.toHaveBeenCalled();

      expect(prisma.mediaSource.create).toHaveBeenCalledTimes(1);
      const createData = prisma.mediaSource.create.mock.calls[0][0].data;
      expect(createData).toMatchObject({
        kind: 'TORRENT_SEARCH',
        seasonId: 42,
        infoHash: validInput.infoHash,
      });
      expect(createData).not.toHaveProperty('episodeId');
    });
  });

  describe('addMagnetToSeason', () => {
    const magnet =
      'magnet:?xt=urn:btih:abc123def456abc123def456abc123def456abc1&dn=Reacher.S02.1080p';

    it('throws error.season.not_found for a missing or unowned season, and creates no source', async () => {
      prisma.season.findFirst.mockResolvedValue(null);

      await expect(service.addMagnetToSeason(42, { magnet, force: false }, 'user-2')).rejects.toThrow(
        'Season 42 does not exist',
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

    // Spec 022, REQ-7 REQ-6
    it('no longer conflicts for a merely-busy season without force', async () => {
      prisma.season.findFirst.mockResolvedValue(season);
      prisma.mediaSource.findFirst.mockResolvedValue({ id: 5, seasonId: 42, status: 'DOWNLOADING' });
      prisma.episode.count.mockResolvedValue(0); // no COMPLETED episode — merely busy
      prisma.mediaSource.findUnique.mockResolvedValue(null);
      qbittorrent.add.mockResolvedValue('/downloads/reacher-s02-v2');
      prisma.mediaSource.create.mockResolvedValue({ id: 101, seasonId: 42 });
      prisma.season.findUniqueOrThrow.mockResolvedValue({ ...season, episodes: [] });

      await service.addMagnetToSeason(42, { magnet, force: false }, 'user-1');

      expect(qbittorrent.add).toHaveBeenCalled();
      expect(prisma.mediaSource.create).toHaveBeenCalled();
      // Untouched: force's demote-to-ERROR block stays 027's, and does not
      // fire just because the guard above no longer conflicts.
      expect(prisma.mediaSource.updateMany).not.toHaveBeenCalled();
    });

    // 027-replace-completed-media: the "at least one COMPLETED episode" branch
    // — swapping this key for the merely-busy one would show the mild
    // "a download is already running" copy to someone about to destroy
    // already-downloaded episodes, with nothing failing anywhere.
    it('rejects with error.season.already_completed when at least one episode is COMPLETED', async () => {
      prisma.season.findFirst.mockResolvedValue(season);
      prisma.mediaSource.findFirst.mockResolvedValue({ id: 5, seasonId: 42, status: 'DOWNLOADING' });
      prisma.episode.count.mockResolvedValue(1);

      await expect(
        service.addMagnetToSeason(42, { magnet, force: false }, 'user-1'),
      ).rejects.toThrow('This season already has downloaded episodes. Confirm to replace the current files.');

      expect(prisma.episode.count).toHaveBeenCalledWith({
        where: { seasonId: 42, status: 'COMPLETED' },
      });
      expect(qbittorrent.add).not.toHaveBeenCalled();
      expect(prisma.mediaSource.create).not.toHaveBeenCalled();
    });

    // A season demoted out of COMPLETED (069) while a delivered source
    // survives must still require confirmation — the episode-COMPLETED
    // count alone would miss it.

    // Spec 087, REQ-2
    it('rejects with error.season.already_completed when no episode is COMPLETED but a delivered source survives', async () => {
      prisma.season.findFirst.mockResolvedValue(season);
      prisma.mediaSource.findFirst.mockResolvedValue({ id: 5, seasonId: 42, status: 'DOWNLOADING' });
      prisma.episode.count.mockResolvedValue(0);
      downloads.hasDeliveredSource.mockResolvedValue(true);

      await expect(
        service.addMagnetToSeason(42, { magnet, force: false }, 'user-1'),
      ).rejects.toThrow('This season already has downloaded episodes. Confirm to replace the current files.');

      expect(downloads.hasDeliveredSource).toHaveBeenCalledWith({ seasonId: 42 });
      expect(qbittorrent.add).not.toHaveBeenCalled();
      expect(prisma.mediaSource.create).not.toHaveBeenCalled();
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
      const demoteOrder = downloads.demoteDeliveredSources.mock.invocationCallOrder[0];
      const createOrder = prisma.mediaSource.create.mock.invocationCallOrder[0];
      expect(addOrder).toBeLessThan(demoteOrder);
      expect(demoteOrder).toBeLessThan(createOrder);

      expect(downloads.demoteDeliveredSources).toHaveBeenCalledWith(
        { seasonId: 42 },
        expect.any(String),
      );
    });

    // A confirmed replacement must not demote a sibling that is still
    // working — only the shared `demoteDeliveredSources` decides which rows
    // are delivered, so this is the proof that this twin asks it the right
    // target and nothing more.

    // Spec 087, REQ-4
    it('with force, demotes only the season-scoped delivered sources, leaving an in-flight sibling alone', async () => {
      prisma.season.findFirst.mockResolvedValue(season);
      prisma.mediaSource.findFirst.mockResolvedValue({ id: 5, seasonId: 42, status: 'DOWNLOADING' });
      prisma.mediaSource.findUnique.mockResolvedValue(null);
      qbittorrent.add.mockResolvedValue('/downloads/reacher-s02-v2');
      prisma.mediaSource.create.mockResolvedValue({ id: 101, seasonId: 42 });
      prisma.season.findUniqueOrThrow.mockResolvedValue({ ...season, episodes: [] });

      await service.addMagnetToSeason(42, { magnet, force: true }, 'user-1');

      expect(downloads.demoteDeliveredSources).toHaveBeenCalledTimes(1);
      expect(downloads.demoteDeliveredSources).toHaveBeenCalledWith(
        { seasonId: 42 },
        expect.any(String),
      );
      // Everything that decides *which* rows are delivered lives in
      // DownloadsService.demoteDeliveredSources — this service only calls it
      // with the right, season-scoped target.
      expect(prisma.mediaSource.updateMany).not.toHaveBeenCalled();
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
        'That magnet is already attached to «Dune»',
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
        'That magnet is already attached to «Reacher S03E01»',
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
        'That magnet is already attached to «Reacher Season 1»',
      );
      expect(qbittorrent.add).not.toHaveBeenCalled();
      expect(prisma.mediaSource.create).not.toHaveBeenCalled();
    });

    it('does not treat a re-request against this same season as a collision', async () => {
      prisma.season.findFirst.mockResolvedValue(season);
      prisma.mediaSource.findFirst.mockResolvedValue(null);
      prisma.mediaSource.findUnique.mockResolvedValue({
        id: 5,
        status: 'ERROR',
        seasonId: 42,
        movie: null,
        episode: null,
        season: { id: 42, seasonNumber: 2, show: { title: 'Reacher' } },
      });
      qbittorrent.info.mockResolvedValue([]);
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

  describe('addMagnetToSeason (duplicate of the same season)', () => {
    const HASH = 'abc123def456abc123def456abc123def456abc1';
    const magnet = `magnet:?xt=urn:btih:${HASH}&dn=Reacher.S02.1080p`;
    const otherUrlMagnet = `${magnet}&tr=udp%3A%2F%2Fother.example%3A1337`;
    const withEpisodes = { ...season, episodes: [{ id: 1 }] };
    const own = (status: string) => ({
      id: 5,
      status,
      seasonId: 42,
      movie: null,
      episode: null,
      season: { id: 42, seasonNumber: 2, show: { title: 'Reacher' } },
    });

    beforeEach(() => {
      prisma.season.findFirst.mockResolvedValue(season);
      prisma.season.findUniqueOrThrow.mockResolvedValue(withEpisodes);
      prisma.episode.count.mockResolvedValue(0);
    });

    function expectNoWrites() {
      expect(prisma.mediaSource.update).not.toHaveBeenCalled();
      expect(prisma.mediaSource.create).not.toHaveBeenCalled();
      expect(prisma.mediaSource.updateMany).not.toHaveBeenCalled();
    }

    it('is a no-op for an active own source even when the second URL differs, returning the season with its episodes', async () => {
      prisma.mediaSource.findUnique.mockResolvedValue(own('DOWNLOADING'));

      const result = await service.addMagnetToSeason(
        42,
        { magnet: otherUrlMagnet, force: false },
        'user-1',
      );

      expect(result).toBe(withEpisodes);
      expect(prisma.season.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 42 },
        include: { episodes: { orderBy: { episodeNumber: 'asc' } } },
      });
      expect(qbittorrent.add).not.toHaveBeenCalled();
      expect(qbittorrent.info).not.toHaveBeenCalled();
      expect(qbittorrent.start).not.toHaveBeenCalled();
      expectNoWrites();
    });

    it.each([true, false])(
      'stays a no-op with a COMPLETED episode and force=%s, demoting nothing',
      async (force) => {
        prisma.episode.count.mockResolvedValue(1);
        prisma.mediaSource.findFirst.mockResolvedValue(own('SCANNED'));
        prisma.mediaSource.findUnique.mockResolvedValue(own('SCANNED'));

        await expect(
          service.addMagnetToSeason(42, { magnet, force }, 'user-1'),
        ).resolves.toBe(withEpisodes);

        expect(qbittorrent.add).not.toHaveBeenCalled();
        expect(qbittorrent.info).not.toHaveBeenCalled();
        expectNoWrites();
      },
    );

    it('starts a held, unfinished ERROR duplicate and keeps its path and url', async () => {
      prisma.mediaSource.findUnique.mockResolvedValue(own('ERROR'));
      qbittorrent.info.mockResolvedValue([{ hash: HASH.toUpperCase(), state: 'PAUSED' }]);

      const result = await service.addMagnetToSeason(
        42,
        { magnet: otherUrlMagnet, force: false },
        'user-1',
      );

      expect(result).toBe(withEpisodes);
      expect(qbittorrent.start).toHaveBeenCalledWith(HASH);
      expect(qbittorrent.add).not.toHaveBeenCalled();
      expect(prisma.mediaSource.update.mock.calls[0][0].data).toEqual({
        status: 'QUEUED',
        errorMessage: null,
        errorKey: null,
        errorParams: null,
      });
      expect(downloads.handleTorrentCompleted).not.toHaveBeenCalled();
    });

    it('demotes an active sibling after start and before the row update when force reactivates', async () => {
      prisma.mediaSource.findFirst.mockResolvedValue({ id: 6, seasonId: 42, status: 'DOWNLOADING' });
      prisma.mediaSource.findUnique.mockResolvedValue(own('ERROR'));
      qbittorrent.info.mockResolvedValue([{ hash: HASH, state: 'PAUSED' }]);

      await service.addMagnetToSeason(42, { magnet, force: true }, 'user-1');

      expect(qbittorrent.start.mock.invocationCallOrder[0]).toBeLessThan(
        downloads.demoteDeliveredSources.mock.invocationCallOrder[0],
      );
      expect(downloads.demoteDeliveredSources.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.mediaSource.update.mock.invocationCallOrder[0],
      );
    });

    it('runs the completion path after the row update for a held, finished ERROR duplicate', async () => {
      prisma.mediaSource.findUnique.mockResolvedValue(own('ERROR'));
      qbittorrent.info.mockResolvedValue([{ hash: HASH, state: 'READY' }]);

      await service.addMagnetToSeason(42, { magnet, force: false }, 'user-1');

      expect(qbittorrent.start).not.toHaveBeenCalled();
      expect(downloads.handleTorrentCompleted).toHaveBeenCalledWith(HASH);
      expect(prisma.mediaSource.update.mock.invocationCallOrder[0]).toBeLessThan(
        downloads.handleTorrentCompleted.mock.invocationCallOrder[0],
      );
    });

    it('performs a genuine add for an ERROR duplicate qBittorrent no longer holds', async () => {
      prisma.mediaSource.findUnique.mockResolvedValue(own('ERROR'));
      qbittorrent.info.mockResolvedValue([{ hash: 'f'.repeat(40), state: 'READY' }]);
      qbittorrent.add.mockResolvedValue('/downloads/new');

      await service.addMagnetToSeason(42, { magnet, force: false }, 'user-1');

      expect(qbittorrent.start).not.toHaveBeenCalled();
      expect(qbittorrent.add).toHaveBeenCalled();
      expect(prisma.mediaSource.update.mock.calls[0][0].data).toMatchObject({
        status: 'QUEUED',
        downloadPath: '/downloads/new',
      });
      expect(downloads.handleTorrentCompleted).not.toHaveBeenCalled();
    });

    it('propagates an unreachable client from an ERROR duplicate before any write', async () => {
      prisma.mediaSource.findFirst.mockResolvedValue({ id: 6, seasonId: 42, status: 'DOWNLOADING' });
      prisma.mediaSource.findUnique.mockResolvedValue(own('ERROR'));
      const failure = new TorrentClientError('down', 503);
      qbittorrent.info.mockRejectedValue(failure);

      await expect(
        service.addMagnetToSeason(42, { magnet, force: true }, 'user-1'),
      ).rejects.toBe(failure);

      expect(qbittorrent.add).not.toHaveBeenCalled();
      expectNoWrites();
    });
  });

  // 068-season-multi-file-upload: the upload-session close is the one place a
  // folder of uploaded files is handed to the scan, and every failure here is
  // silent to the caller:
  //  - a second finishSeasonUpload that is not refused enqueues a second scan
  //    of the same folder, encoding the season twice into the same destination
  //    paths, with two success-looking responses;
  //  - closing an empty session as READY enqueues a scan of an empty folder
  //    and reports a season that will never produce a job;
  //  - startSeasonUpload without the COMPLETED-episode guard (or with `force`
  //    not demoting) lets an upload silently sit beside, or clobber, a season
  //    that already finished;
  //  - a session that lost resolveRace flipped to READY anyway would encode a
  //    season a sibling source already owns.
  describe('season upload sessions', () => {
    let dir: string;

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'season-upload-'));
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    describe('startSeasonUpload', () => {
      beforeEach(() => {
        prisma.season.findFirst.mockResolvedValue(season);
        prisma.mediaSource.create.mockResolvedValue({ id: 900 });
        mediaRoots.resolveFromRoot.mockResolvedValue(dir);
      });

      it('refuses a season with a COMPLETED episode without force and creates nothing', async () => {
        prisma.episode.count.mockResolvedValue(1);

        await expect(service.startSeasonUpload(42, false, 'user-1')).rejects.toMatchObject({
          response: { i18n: { key: 'error.season.already_completed' } },
        });

        expect(prisma.mediaSource.create).not.toHaveBeenCalled();
        expect(prisma.mediaSource.updateMany).not.toHaveBeenCalled();
        expect(await readdir(dir)).toEqual([]);
      });

      // Spec 087, REQ-2
      it('refuses a season with no COMPLETED episode but a delivered source, without force', async () => {
        prisma.episode.count.mockResolvedValue(0);
        downloads.hasDeliveredSource.mockResolvedValue(true);

        await expect(service.startSeasonUpload(42, false, 'user-1')).rejects.toMatchObject({
          response: { i18n: { key: 'error.season.already_completed' } },
        });

        expect(downloads.hasDeliveredSource).toHaveBeenCalledWith({ seasonId: 42 });
        expect(prisma.mediaSource.create).not.toHaveBeenCalled();
      });

      it('with force demotes delivered sources before creating the session row', async () => {
        prisma.episode.count.mockResolvedValue(1);

        const result = await service.startSeasonUpload(42, true, 'user-1');

        expect(result).toEqual({ mediaSourceId: 900, seasonId: 42 });
        expect(downloads.demoteDeliveredSources).toHaveBeenCalledTimes(1);
        expect(downloads.demoteDeliveredSources).toHaveBeenCalledWith(
          { seasonId: 42 },
          expect.any(String),
        );
        expect(downloads.demoteDeliveredSources.mock.invocationCallOrder[0]).toBeLessThan(
          prisma.mediaSource.create.mock.invocationCallOrder[0],
        );
        expect(prisma.mediaSource.create.mock.calls[0][0].data).toMatchObject({
          kind: 'LOCAL_FOLDER',
          status: 'PENDING',
          seasonId: 42,
        });
      });

      // Same proof as addMagnetToSeason's — the season-scoped target is all
      // this service contributes; which rows are delivered is the shared
      // predicate's job, not this guard's.

      // Spec 087, REQ-4
      it('with force calls demoteDeliveredSources season-scoped, never the raw status filter', async () => {
        prisma.episode.count.mockResolvedValue(0);
        downloads.hasDeliveredSource.mockResolvedValue(true);

        await service.startSeasonUpload(42, true, 'user-1');

        expect(downloads.demoteDeliveredSources).toHaveBeenCalledWith(
          { seasonId: 42 },
          expect.any(String),
        );
        expect(prisma.mediaSource.updateMany).not.toHaveBeenCalled();
      });
    });

    describe('finishSeasonUpload', () => {
      const open = () => ({ id: 900, seasonId: 42, downloadPath: dir });

      beforeEach(() => {
        prisma.season.findUniqueOrThrow.mockResolvedValue({ id: 42, episodes: [] });
      });

      it('refuses a second close without enqueueing a second scan', async () => {
        await writeFile(join(dir, 'e01.mkv'), 'x');
        sessions.findOpenSeasonSession.mockResolvedValueOnce(open()).mockResolvedValueOnce(null);
        downloads.resolveRace.mockResolvedValue({ outcome: 'WON', message: 'ganador: mediaSource 900, 0 pausado(s)' });
        prisma.mediaSource.updateMany.mockResolvedValue({ count: 1 });

        await service.finishSeasonUpload(900, 'user-1');
        await expect(service.finishSeasonUpload(900, 'user-1')).rejects.toMatchObject({
          response: { i18n: { key: 'error.upload.session_not_open' } },
        });

        expect(queue.addSourceReady).toHaveBeenCalledTimes(1);
      });

      it('does not enqueue when a concurrent close already flipped the row', async () => {
        await writeFile(join(dir, 'e01.mkv'), 'x');
        sessions.findOpenSeasonSession.mockResolvedValue(open());
        downloads.resolveRace.mockResolvedValue({ outcome: 'WON', message: 'ganador: mediaSource 900, 0 pausado(s)' });
        prisma.mediaSource.updateMany.mockResolvedValue({ count: 0 });

        await expect(service.finishSeasonUpload(900, 'user-1')).rejects.toMatchObject({
          response: { i18n: { key: 'error.upload.session_not_open' } },
        });

        expect(queue.addSourceReady).not.toHaveBeenCalled();
      });

      it('refuses an empty session, leaving it PENDING with nothing enqueued', async () => {
        await mkdir(join(dir, 'nested'));
        sessions.findOpenSeasonSession.mockResolvedValue(open());

        await expect(service.finishSeasonUpload(900, 'user-1')).rejects.toMatchObject({
          response: { i18n: { key: 'error.upload.session_empty' } },
        });

        expect(prisma.mediaSource.updateMany).not.toHaveBeenCalled();
        expect(prisma.mediaSource.update).not.toHaveBeenCalled();
        expect(downloads.resolveRace).not.toHaveBeenCalled();
        expect(queue.addSourceReady).not.toHaveBeenCalled();
      });

      it('answers superseded when the session loses the race, without READY or enqueue', async () => {
        await writeFile(join(dir, 'e01.mkv'), 'x');
        sessions.findOpenSeasonSession.mockResolvedValue(open());
        downloads.resolveRace.mockResolvedValue({
          outcome: 'SUPERSEDED',
          message: 'mediaSource 900 superado, el target ya tiene un ganador',
        });

        await expect(service.finishSeasonUpload(900, 'user-1')).rejects.toMatchObject({
          response: { i18n: { key: 'error.upload.superseded' } },
        });

        expect(prisma.mediaSource.updateMany).not.toHaveBeenCalled();
        expect(queue.addSourceReady).not.toHaveBeenCalled();
      });
    });
  });

  // Spec 089, REQ-13; Spec 089, AC-14 — 059 recorded the season-pack lift as a read-time projection with "no
  // un-write anywhere" — status materialization turns the read-time max into
  // a stored column, so that claim has to be re-proven: if attaching a pack
  // does not trigger a season recompute, the aired episode never lifts off
  // MISSING in the first place; if deleting it does not trigger one, the
  // episode is stuck reading QUEUED forever with a torrent that no longer
  // exists and nothing in any log to explain why. This runs the real
  // TitleStatusService (not a mock) so the write TitleStatusService actually
  // issues is what's asserted, not a stand-in for it.
  describe('status materialization (089, REQ-13)', () => {
    const validSeasonTorrentInput = {
      infoHash: 'abc123def456abc123def456abc123def456abc',
      urls: ['https://indexer.example/download/123'],
      releaseTitle: 'Reacher S02 1080p',
      force: false,
    };

    it('lifts an aired episode to QUEUED on attach, and drops it back to MISSING once the pack is gone', async () => {
      const episodeRow = {
        id: 7,
        status: 'MISSING',
        filePath: null,
        mediaServerPresentAt: null,
        releaseDate: new Date('2020-01-01'),
        mediaSources: [],
        processJobs: [],
        season: { showId: 1, mediaSources: [] as { status: string }[] },
      };
      const showRow = { status: 'MISSING', seasons: [{ episodes: [episodeRow] }] };

      const realPrisma: any = {
        season: {
          findUnique: jest.fn(async () => ({ showId: 1, episodes: [{ id: episodeRow.id }] })),
        },
        episode: {
          findUnique: jest.fn(async () => episodeRow),
          updateMany: jest.fn(async ({ data }: any) => {
            episodeRow.status = data.status;
            return { count: 1 };
          }),
        },
        show: {
          findUnique: jest.fn(async () => ({ ...showRow, seasons: [{ episodes: [episodeRow] }] })),
          updateMany: jest.fn(async () => ({ count: 1 })),
        },
      };
      const realTitleStatus = new TitleStatusService(realPrisma);

      prisma.season.findFirst.mockResolvedValue(season);
      prisma.mediaSource.findFirst.mockResolvedValue(null);
      prisma.mediaSource.findUnique.mockResolvedValue(null);
      qbittorrent.add.mockResolvedValue('/downloads/reacher-s02');
      // The attach's own write lands on the outer, mocked `prisma` — this
      // mirrors that into the fixture realTitleStatus reads from, the same
      // way a real database would make one write visible to the other query.
      prisma.mediaSource.create.mockImplementation(async () => {
        episodeRow.season.mediaSources.push({ status: 'QUEUED' });
        return { id: 100, seasonId: 42 };
      });
      prisma.season.findUniqueOrThrow.mockResolvedValue({ ...season, episodes: [] });

      const moduleWithRealTitleStatus: TestingModule = await Test.createTestingModule({
        providers: [
          SeasonsService,
          AttachSourceService,
          { provide: PrismaService, useValue: prisma },
          { provide: QbittorrentClient, useValue: qbittorrent },
          { provide: DownloadsService, useValue: downloads },
          { provide: SettingsService, useValue: { getMap: jest.fn().mockResolvedValue({}) } },
          { provide: MediaRootsService, useValue: mediaRoots },
          { provide: ProcessQueueService, useValue: queue },
          { provide: SessionService, useValue: sessions },
          { provide: UploadsService, useValue: uploads },
          { provide: TitleStatusService, useValue: realTitleStatus },
        ],
      }).compile();
      const serviceWithRealTitleStatus = moduleWithRealTitleStatus.get<SeasonsService>(SeasonsService);

      expect(episodeRow.status).toBe('MISSING');

      // The pack attaches: the aired episode, with nothing else backing it,
      // lifts off MISSING because a non-ERROR, non-SCANNED season source now
      // exists (isLiftedBySeasonPack).
      await serviceWithRealTitleStatus.addTorrentToSeason(42, validSeasonTorrentInput, 'user-1');
      expect(episodeRow.status).toBe('QUEUED');

      // The pack is gone (deleted, scanned or errored) — the season has no
      // live source left. Nothing but a fresh recompute un-does the lift;
      // this is the call downloadDelete's unwind already makes through the
      // very same TitleStatusService instance.
      episodeRow.season.mediaSources = [];
      await realTitleStatus.recomputeSeason(42);
      expect(episodeRow.status).toBe('MISSING');
    });
  });
});
