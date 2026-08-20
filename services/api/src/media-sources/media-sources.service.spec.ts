import { Test, TestingModule } from '@nestjs/testing';
import { MediaSourcesService } from './media-sources.service';
import { PrismaService } from '@/prisma/prisma.service';
import { EncodeQueueService } from '@/queue/encode-queue.service';
import { SourceFileInput } from './dto/source-file.input';
import { ScannedMatchInput } from './dto/scanned-match.input';

// This suite exists because sourceScanned's per-match episode resolution is
// the only place a season pack's files get filed under a row in the
// database, and every way it can go wrong is silent: no exception, no failed
// job, just a wrong or missing database write.
//
// - A file resolved to the WRONG episode: right show, right season, off-by-one
//   (or worse, an index into `season.episodes` instead of a lookup by
//   `episodeNumber`) files S02E05's video under S02E04's row. Both
//   ProcessJobs report COMPLETED; the library plays the wrong episode under
//   the wrong title.
// - `hasUnmatchedFiles` computed over every reported file instead of only the
//   video ones: a torrent's `.nfo`/`.srt` siblings would permanently set the
//   flag, `deleteDownloadPath` (computed downstream in ProcessJobsService)
//   would never fire again, and disk fills with no error anywhere.
// - Two files racing for the same episode: REQ-5 makes the worker's
//   `select-matches.ts` respsonsible for keeping one match per episode, but
//   if a bug ever let two matches for the same `episodeNumber` reach this
//   service, both must still resolve to the SAME correct episode id — not to
//   two different ids because of stale/shared state in the resolution loop,
//   which would file the two competing encodes under two different wrong
//   episodes instead of the one right one.
describe('MediaSourcesService — sourceScanned fan-out', () => {
  let service: MediaSourcesService;
  let prisma: {
    mediaSource: { findUnique: jest.Mock };
    processJob: { updateMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let tx: {
    mediaSource: { findUnique: jest.Mock; update: jest.Mock };
    movie: { update: jest.Mock };
    episode: { update: jest.Mock };
    sourceFile: { upsert: jest.Mock };
    processJob: { findUnique: jest.Mock; create: jest.Mock };
  };
  let encodeQueue: { addEncode: jest.Mock };

  const videoFile = (filePath: string): SourceFileInput =>
    ({ filePath, fileName: filePath, isVideo: true }) as SourceFileInput;
  const sidecarFile = (filePath: string): SourceFileInput =>
    ({ filePath, fileName: filePath, isVideo: false }) as SourceFileInput;
  const match = (
    filePath: string,
    seasonNumber: number | null = null,
    episodeNumber: number | null = null,
  ): ScannedMatchInput => ({ filePath, seasonNumber, episodeNumber }) as ScannedMatchInput;

  beforeEach(async () => {
    tx = {
      mediaSource: { findUnique: jest.fn(), update: jest.fn() },
      movie: { update: jest.fn() },
      episode: { update: jest.fn() },
      sourceFile: { upsert: jest.fn() },
      processJob: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
    };

    prisma = {
      mediaSource: { findUnique: jest.fn().mockResolvedValue({ id: 0, movie: null }) },
      processJob: { updateMany: jest.fn() },
      $transaction: jest.fn(async (callback: (tx: unknown) => Promise<void>) => callback(tx)),
    };

    encodeQueue = { addEncode: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediaSourcesService,
        { provide: PrismaService, useValue: prisma },
        { provide: EncodeQueueService, useValue: encodeQueue },
      ],
    }).compile();

    service = module.get<MediaSourcesService>(MediaSourcesService);
  });

  // A unique row id per created SourceFile, indexed by the order sourceFile.upsert is called in.
  const wireSourceFileUpsert = () => {
    let nextId = 900;
    tx.sourceFile.upsert.mockImplementation(async () => ({ id: nextId++ }));
  };

  const wireProcessJobCreate = () => {
    let nextId = 9000;
    tx.processJob.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({ id: nextId++, ...data }),
    );
  };

  it('a single-episode source resolves matches to mediaSource.episodeId regardless of parsed numbers', async () => {
    wireSourceFileUpsert();
    wireProcessJobCreate();
    tx.mediaSource.findUnique.mockResolvedValue({
      id: 10,
      status: 'ENCODING',
      episodeId: 555,
      movie: null,
      season: null,
    });

    const files = [videoFile('Show.S02E01.mkv')];
    const matches = [match('Show.S02E01.mkv')];

    await service.sourceScanned(10, files, matches);

    expect(tx.sourceFile.upsert).toHaveBeenCalledWith({
      where: { mediaSourceId_filePath: { mediaSourceId: 10, filePath: 'Show.S02E01.mkv' } },
      create: { mediaSourceId: 10, filePath: 'Show.S02E01.mkv', movieId: null, episodeId: 555 },
      update: { movieId: null, episodeId: 555 },
    });
    expect(tx.processJob.create).toHaveBeenCalledWith({
      data: { sourceFileId: 900, movieId: null, episodeId: 555, status: 'WAITING' },
    });
    expect(tx.episode.update).toHaveBeenCalledWith({ where: { id: 555 }, data: { status: 'ENCODING' } });
    expect(tx.mediaSource.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { status: 'SCANNED', errorMessage: null, errorKey: null, errorParams: null, hasUnmatchedFiles: false },
    });
    expect(encodeQueue.addEncode).toHaveBeenCalledWith({ processJobId: 9000 });
  });

  it('a season pack resolves every match by episodeNumber, not by its position in season.episodes', async () => {
    wireSourceFileUpsert();
    wireProcessJobCreate();
    // Deliberately out of numeric order: an implementation that indexed into
    // this array by match position instead of looking episodeNumber up in a
    // map would file every one of these three files under the wrong episode.
    tx.mediaSource.findUnique.mockResolvedValue({
      id: 20,
      status: 'ENCODING',
      episodeId: null,
      movie: null,
      season: {
        seasonNumber: 2,
        episodes: [
          { id: 302, episodeNumber: 2 },
          { id: 303, episodeNumber: 3 },
          { id: 301, episodeNumber: 1 },
        ],
      },
    });

    const files = [
      videoFile('Show.S02E01.mkv'),
      videoFile('Show.S02E02.mkv'),
      videoFile('Show.S02E03.mkv'),
    ];
    const matches = [
      match('Show.S02E01.mkv', 2, 1),
      match('Show.S02E02.mkv', 2, 2),
      match('Show.S02E03.mkv', 2, 3),
    ];

    await service.sourceScanned(20, files, matches);

    expect(tx.sourceFile.upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ create: expect.objectContaining({ filePath: 'Show.S02E01.mkv', episodeId: 301 }) }),
    );
    expect(tx.sourceFile.upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ create: expect.objectContaining({ filePath: 'Show.S02E02.mkv', episodeId: 302 }) }),
    );
    expect(tx.sourceFile.upsert).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ create: expect.objectContaining({ filePath: 'Show.S02E03.mkv', episodeId: 303 }) }),
    );
    expect(tx.episode.update).toHaveBeenCalledWith({ where: { id: 301 }, data: { status: 'ENCODING' } });
    expect(tx.episode.update).toHaveBeenCalledWith({ where: { id: 302 }, data: { status: 'ENCODING' } });
    expect(tx.episode.update).toHaveBeenCalledWith({ where: { id: 303 }, data: { status: 'ENCODING' } });
    expect(tx.mediaSource.update).toHaveBeenCalledWith({
      where: { id: 20 },
      data: { status: 'SCANNED', errorMessage: null, errorKey: null, errorParams: null, hasUnmatchedFiles: false },
    });
  });

  it('a match whose seasonNumber differs from the season is skipped and counted as unmatched', async () => {
    wireSourceFileUpsert();
    wireProcessJobCreate();
    tx.mediaSource.findUnique.mockResolvedValue({
      id: 30,
      status: 'ENCODING',
      episodeId: null,
      movie: null,
      season: { seasonNumber: 2, episodes: [{ id: 401, episodeNumber: 1 }] },
    });

    const files = [videoFile('Show.S02E01.mkv'), videoFile('Show.S03E01.mkv')];
    const matches = [match('Show.S02E01.mkv', 2, 1), match('Show.S03E01.mkv', 3, 1)];

    await service.sourceScanned(30, files, matches);

    // Only the correctly-scoped match produced a row.
    expect(tx.sourceFile.upsert).toHaveBeenCalledTimes(1);
    expect(tx.sourceFile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ filePath: 'Show.S02E01.mkv', episodeId: 401 }) }),
    );
    expect(tx.mediaSource.update).toHaveBeenCalledWith({
      where: { id: 30 },
      data: { status: 'SCANNED', errorMessage: null, errorKey: null, errorParams: null, hasUnmatchedFiles: true },
    });
  });

  it('a match whose episodeNumber is not in the season is skipped and counted as unmatched', async () => {
    wireSourceFileUpsert();
    wireProcessJobCreate();
    tx.mediaSource.findUnique.mockResolvedValue({
      id: 40,
      status: 'ENCODING',
      episodeId: null,
      movie: null,
      season: { seasonNumber: 2, episodes: [{ id: 401, episodeNumber: 1 }, { id: 402, episodeNumber: 2 }] },
    });

    const files = [videoFile('Show.S02E01.mkv'), videoFile('Show.S02E09.mkv')];
    const matches = [match('Show.S02E01.mkv', 2, 1), match('Show.S02E09.mkv', 2, 9)];

    await service.sourceScanned(40, files, matches);

    expect(tx.sourceFile.upsert).toHaveBeenCalledTimes(1);
    expect(tx.sourceFile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ filePath: 'Show.S02E01.mkv', episodeId: 401 }) }),
    );
    expect(tx.mediaSource.update).toHaveBeenCalledWith({
      where: { id: 40 },
      data: { status: 'SCANNED', errorMessage: null, errorKey: null, errorParams: null, hasUnmatchedFiles: true },
    });
  });

  it('a non-video sidecar left out of matches does not trip hasUnmatchedFiles', async () => {
    wireSourceFileUpsert();
    wireProcessJobCreate();
    tx.mediaSource.findUnique.mockResolvedValue({
      id: 50,
      status: 'ENCODING',
      episodeId: 700,
      movie: null,
      season: null,
    });

    // The .nfo is part of `files` (a complete inventory) but never appears in
    // `matches` — exactly what the worker sends for a sidecar it never
    // considered a candidate.
    const files = [videoFile('Movie.mkv'), sidecarFile('Movie.nfo')];
    const matches = [match('Movie.mkv')];

    await service.sourceScanned(50, files, matches);

    expect(tx.mediaSource.update).toHaveBeenCalledWith({
      where: { id: 50 },
      data: { status: 'SCANNED', errorMessage: null, errorKey: null, errorParams: null, hasUnmatchedFiles: false },
    });
  });

  it('a skipped video file trips hasUnmatchedFiles, unlike a sidecar', async () => {
    wireSourceFileUpsert();
    wireProcessJobCreate();
    tx.mediaSource.findUnique.mockResolvedValue({
      id: 60,
      status: 'ENCODING',
      episodeId: null,
      movie: null,
      season: { seasonNumber: 1, episodes: [{ id: 801, episodeNumber: 1 }] },
    });

    // "sample.mkv" is video but the worker's filename parse could not resolve
    // it to any episode number, so it never appears in `matches` at all.
    const files = [videoFile('Show.S01E01.mkv'), videoFile('sample.mkv')];
    const matches = [match('Show.S01E01.mkv', 1, 1)];

    await service.sourceScanned(60, files, matches);

    expect(tx.mediaSource.update).toHaveBeenCalledWith({
      where: { id: 60 },
      data: { status: 'SCANNED', errorMessage: null, errorKey: null, errorParams: null, hasUnmatchedFiles: true },
    });
  });

  it('matches: [] takes the existing ERROR branch and creates no ProcessJob', async () => {
    tx.mediaSource.findUnique.mockResolvedValue({
      id: 70,
      status: 'ENCODING',
      episodeId: null,
      movie: { id: 900 },
      season: null,
    });

    await service.sourceScanned(70, [], []);

    expect(tx.sourceFile.upsert).not.toHaveBeenCalled();
    expect(tx.processJob.create).not.toHaveBeenCalled();
    expect(tx.mediaSource.update).toHaveBeenCalledWith({
      where: { id: 70 },
      data: {
        status: 'ERROR',
        errorMessage: 'Scan found no main video file: empty folder or no video',
        errorKey: 'error.source.scan_no_video',
        errorParams: null,
        hasUnmatchedFiles: false,
      },
    });
    expect(tx.movie.update).toHaveBeenCalledWith({ where: { id: 900 }, data: { status: 'ERROR' } });
    expect(encodeQueue.addEncode).not.toHaveBeenCalled();
  });

  it('two files racing for the same episode both resolve to that one correct episode, not two different ones', async () => {
    wireSourceFileUpsert();
    wireProcessJobCreate();
    // REQ-5 leaves it to the worker's select-matches.ts to keep at most one
    // match per episode ("largest wins"); this only guards api's own
    // resolution loop against a shared-state bug that would send the two
    // competing files to two different (both wrong) episodes instead of
    // both correctly landing on the one they actually parsed to.
    tx.mediaSource.findUnique.mockResolvedValue({
      id: 80,
      status: 'ENCODING',
      episodeId: null,
      movie: null,
      season: { seasonNumber: 1, episodes: [{ id: 401, episodeNumber: 1 }] },
    });

    const files = [videoFile('Show.S01E01.mkv'), videoFile('Show.S01E01.sample.mkv')];
    const matches = [match('Show.S01E01.mkv', 1, 1), match('Show.S01E01.sample.mkv', 1, 1)];

    await service.sourceScanned(80, files, matches);

    expect(tx.sourceFile.upsert).toHaveBeenCalledTimes(2);
    expect(tx.sourceFile.upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ create: expect.objectContaining({ filePath: 'Show.S01E01.mkv', episodeId: 401 }) }),
    );
    expect(tx.sourceFile.upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        create: expect.objectContaining({ filePath: 'Show.S01E01.sample.mkv', episodeId: 401 }),
      }),
    );
  });
});
