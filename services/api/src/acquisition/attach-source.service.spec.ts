import { HttpException } from '@nestjs/common';
import { AttachSourceService, AttachInput } from './attach-source.service';
import { AttachTarget } from './attach-target';
import { ERROR_KEYS, ErrorKey } from '@/i18n/error-keys';
import { SourceKind, SourceStatus } from '@prisma/client';

// This suite exists because two bugs in the pre-088 three-copy attach path
// produced no error anywhere, in any log, and no failure in any existing
// test: (1) a MediaSource could be written with two target columns set
// (movieId *and* seasonId, for example) because only SeasonsService checked
// the season column before writing — every downstream consumer reads one
// target only (worker's source-ready.job.ts reads movieId alone,
// DownloadsService.resolveRace takes the first non-null of the three,
// MediaSourcesService.sourceScanned resolves a single target), so the row
// silently mis-routes with a success response and nothing to notice; (2) a
// cross-target collision — the same infoHash already attached to a film, an
// episode or a season other than the one being attached to now — was
// accepted instead of refused, which is exactly how (1) happens. This suite
// drives AttachSourceService.attach() directly, with a fake AttachTarget per
// case, and asserts both that the refusal is thrown and that no write
// (create/update) and no qBittorrent add() is ever reached once a collision
// is detected.
describe('AttachSourceService — cross-target collisions (Spec 088, REQ-2 REQ-3 REQ-4 REQ-9)', () => {
  let prisma: {
    mediaSource: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };
  let qbittorrent: {
    add: jest.Mock;
    info: jest.Mock;
    start: jest.Mock;
  };
  let downloads: {
    demoteDeliveredSources: jest.Mock;
    handleTorrentCompleted: jest.Mock;
  };
  let service: AttachSourceService;

  beforeEach(() => {
    prisma = {
      mediaSource: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    qbittorrent = {
      add: jest.fn(),
      info: jest.fn(),
      start: jest.fn(),
    };
    downloads = {
      demoteDeliveredSources: jest.fn(),
      handleTorrentCompleted: jest.fn(),
    };

    service = new AttachSourceService(
      prisma as never,
      qbittorrent as never,
      downloads as never,
    );
  });

  function buildTarget(
    column: 'movieId' | 'episodeId' | 'seasonId',
    id = 99,
  ): AttachTarget<{ id: number }> & { refuse: jest.Mock } {
    return {
      resolve: jest.fn().mockResolvedValue({ id }),
      refuse: jest.fn().mockResolvedValue(undefined),
      labels: jest.fn().mockReturnValue({ tags: [], category: 'movie' }),
      column,
    };
  }

  function buildInput(overrides: Partial<AttachInput> = {}): AttachInput {
    return {
      kind: SourceKind.TORRENT_SEARCH,
      infoHash: '5d4a2f1c8e3b9a7d6c5e4f3a2b1c0d9e8f7a6b5c',
      urls: [],
      releaseTitle: null,
      force: false,
      ...overrides,
    };
  }

  // Since 018-ui-i18n, api throw sites carry an i18n key, not a Spanish
  // sentence; assert on the key and params rather than on message
  // substrings.
  async function expectI18nConflict(
    fn: () => Promise<unknown>,
    key: ErrorKey,
    params: Record<string, string | number>,
  ): Promise<void> {
    let thrown: unknown;
    try {
      await fn();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(HttpException);
    const response = (thrown as HttpException).getResponse() as {
      i18n?: { key: string; params?: Record<string, unknown> };
    };
    expect(response.i18n?.key).toBe(key);
    expect(response.i18n?.params).toEqual(params);
  }

  function assertNothingWritten(): void {
    expect(prisma.mediaSource.create).not.toHaveBeenCalled();
    expect(prisma.mediaSource.update).not.toHaveBeenCalled();
    expect(qbittorrent.add).not.toHaveBeenCalled();
    expect(downloads.demoteDeliveredSources).not.toHaveBeenCalled();
  }

  it('refuses a film target whose infoHash already holds a different episode', async () => {
    prisma.mediaSource.findUnique.mockResolvedValue({
      id: 1,
      status: SourceStatus.QUEUED,
      movie: null,
      season: null,
      episode: {
        episodeNumber: 5,
        season: { seasonNumber: 2, show: { title: 'Breaking Bad' } },
      },
    });
    const target = buildTarget('movieId');

    await expectI18nConflict(
      () => service.attach(target, buildInput(), 'user-1'),
      ERROR_KEYS.MAGNET_ALREADY_ATTACHED,
      { title: 'Breaking Bad S02E05' },
    );
    expect(target.refuse).not.toHaveBeenCalled();
    assertNothingWritten();
  });

  it('refuses a film target whose infoHash already holds a season pack', async () => {
    prisma.mediaSource.findUnique.mockResolvedValue({
      id: 1,
      status: SourceStatus.QUEUED,
      movie: null,
      episode: null,
      season: { seasonNumber: 3, show: { title: 'The Wire' } },
    });
    const target = buildTarget('movieId');

    await expectI18nConflict(
      () => service.attach(target, buildInput(), 'user-1'),
      ERROR_KEYS.MAGNET_ALREADY_ATTACHED_SEASON,
      { show: 'The Wire', number: 3 },
    );
    assertNothingWritten();
  });

  it('refuses an episode target whose infoHash already holds a film', async () => {
    prisma.mediaSource.findUnique.mockResolvedValue({
      id: 1,
      status: SourceStatus.QUEUED,
      movie: { title: 'Dune' },
      episode: null,
      season: null,
    });
    const target = buildTarget('episodeId');

    await expectI18nConflict(
      () => service.attach(target, buildInput(), 'user-1'),
      ERROR_KEYS.MAGNET_ALREADY_ATTACHED,
      { title: 'Dune' },
    );
    assertNothingWritten();
  });

  it('refuses an episode target whose infoHash already holds a season pack', async () => {
    prisma.mediaSource.findUnique.mockResolvedValue({
      id: 1,
      status: SourceStatus.QUEUED,
      movie: null,
      episode: null,
      season: { seasonNumber: 1, show: { title: 'Severance' } },
    });
    const target = buildTarget('episodeId');

    await expectI18nConflict(
      () => service.attach(target, buildInput(), 'user-1'),
      ERROR_KEYS.MAGNET_ALREADY_ATTACHED_SEASON,
      { show: 'Severance', number: 1 },
    );
    assertNothingWritten();
  });

  it('refuses a season target whose infoHash already holds a film', async () => {
    prisma.mediaSource.findUnique.mockResolvedValue({
      id: 1,
      status: SourceStatus.QUEUED,
      movie: { title: 'Dune' },
      episode: null,
      season: null,
    });
    const target = buildTarget('seasonId');

    await expectI18nConflict(
      () => service.attach(target, buildInput(), 'user-1'),
      ERROR_KEYS.MAGNET_ALREADY_ATTACHED,
      { title: 'Dune' },
    );
    assertNothingWritten();
  });

  it('refuses a season target whose infoHash already holds a different episode', async () => {
    prisma.mediaSource.findUnique.mockResolvedValue({
      id: 1,
      status: SourceStatus.QUEUED,
      movie: null,
      season: null,
      episode: {
        episodeNumber: 1,
        season: { seasonNumber: 3, show: { title: 'Severance' } },
      },
    });
    const target = buildTarget('seasonId');

    await expectI18nConflict(
      () => service.attach(target, buildInput(), 'user-1'),
      ERROR_KEYS.MAGNET_ALREADY_ATTACHED,
      { title: 'Severance S03E01' },
    );
    assertNothingWritten();
  });

  // The conflict check never consults the holder's own status (spec.md's
  // deliberate asymmetry). An implementer "fixing" this while unifying the
  // three copies is exactly the regression this test pins against — an
  // ERROR holder must refuse a cross-target collision exactly as a healthy
  // one does.
  it('still refuses a cross-target collision when the holding source is in ERROR', async () => {
    prisma.mediaSource.findUnique.mockResolvedValue({
      id: 1,
      status: SourceStatus.ERROR,
      movie: { title: 'Dune' },
      episode: null,
      season: null,
    });
    const target = buildTarget('episodeId');

    await expectI18nConflict(
      () => service.attach(target, buildInput(), 'user-1'),
      ERROR_KEYS.MAGNET_ALREADY_ATTACHED,
      { title: 'Dune' },
    );
    assertNothingWritten();
  });
});

// This suite exists because treating a retired row like any other healthy
// row would make re-adding its own infoHash answer UNCHANGED (Spec 090,
// REQ-6) — a silent no-op that leaves the title permanently stuck on the
// bad, replaced source with no path back to re-acquiring it. And if the
// reactivation write sets status QUEUED without also clearing retiredAt in
// the same write (Spec 090, NFR-3), the row goes live again while still
// being excluded from its own race by isRaceWinner/isDeliveredSource — the
// same "no error anywhere" stall, from the other direction.
describe('AttachSourceService — reactivating a retired source (Spec 090, REQ-6 NFR-3)', () => {
  let prisma: {
    mediaSource: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };
  let qbittorrent: {
    add: jest.Mock;
    info: jest.Mock;
    start: jest.Mock;
  };
  let downloads: {
    demoteDeliveredSources: jest.Mock;
    handleTorrentCompleted: jest.Mock;
  };
  let service: AttachSourceService;

  beforeEach(() => {
    prisma = {
      mediaSource: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    qbittorrent = {
      add: jest.fn(),
      info: jest.fn(),
      start: jest.fn(),
    };
    downloads = {
      demoteDeliveredSources: jest.fn(),
      handleTorrentCompleted: jest.fn(),
    };

    service = new AttachSourceService(
      prisma as never,
      qbittorrent as never,
      downloads as never,
    );
  });

  function buildTarget(
    column: 'movieId' | 'episodeId' | 'seasonId',
    id = 42,
  ): AttachTarget<{ id: number }> & { refuse: jest.Mock } {
    return {
      resolve: jest.fn().mockResolvedValue({ id }),
      refuse: jest.fn().mockResolvedValue(undefined),
      labels: jest.fn().mockReturnValue({ tags: [], category: 'movie' }),
      column,
    };
  }

  function buildInput(overrides: Partial<AttachInput> = {}): AttachInput {
    return {
      kind: SourceKind.TORRENT_SEARCH,
      infoHash: '5d4a2f1c8e3b9a7d6c5e4f3a2b1c0d9e8f7a6b5c',
      urls: [],
      releaseTitle: null,
      force: false,
      ...overrides,
    };
  }

  const retiredSource = {
    id: 7,
    movieId: 42,
    episodeId: null,
    seasonId: null,
    status: SourceStatus.SCANNED,
    retiredAt: new Date('2026-10-01T00:00:00Z'),
    movie: { title: 'Dune' },
    episode: null,
    season: null,
  };

  it('reactivates a retired source still held by qBittorrent, rather than answering UNCHANGED', async () => {
    prisma.mediaSource.findUnique.mockResolvedValue(retiredSource);
    qbittorrent.info.mockResolvedValue([
      { hash: '5d4a2f1c8e3b9a7d6c5e4f3a2b1c0d9e8f7a6b5c', state: 'downloading' },
    ]);
    const target = buildTarget('movieId');

    const outcome = await service.attach(target, buildInput(), 'user-1');

    expect(outcome).toBe('ATTACHED');
    expect(qbittorrent.start).toHaveBeenCalled();
    expect(prisma.mediaSource.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: {
        status: 'QUEUED',
        errorMessage: null,
        errorKey: null,
        errorParams: null,
        retiredAt: null,
      },
    });
  });

  it('clears retiredAt on the fallback add() path too, when qBittorrent no longer holds the torrent', async () => {
    prisma.mediaSource.findUnique.mockResolvedValue(retiredSource);
    qbittorrent.info.mockResolvedValue([]);
    qbittorrent.add.mockResolvedValue('/downloads/dune');
    const target = buildTarget('movieId');

    const outcome = await service.attach(target, buildInput(), 'user-1');

    expect(outcome).toBe('ATTACHED');
    expect(prisma.mediaSource.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: expect.objectContaining({
        status: 'QUEUED',
        retiredAt: null,
        movieId: 42,
      }),
    });
  });

  it('does not return UNCHANGED for a retired source with the same infoHash and target', async () => {
    prisma.mediaSource.findUnique.mockResolvedValue(retiredSource);
    qbittorrent.info.mockResolvedValue([
      { hash: '5d4a2f1c8e3b9a7d6c5e4f3a2b1c0d9e8f7a6b5c', state: 'downloading' },
    ]);
    const target = buildTarget('movieId');

    const outcome = await service.attach(target, buildInput(), 'user-1');

    expect(outcome).not.toBe('UNCHANGED');
    expect(prisma.mediaSource.update).toHaveBeenCalled();
  });
});
