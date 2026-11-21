import type { HttpException } from '@nestjs/common';
import { LibraryTagsService } from './library-tags.service';
import { LibraryTagOutcome } from './entities/library-tag-enums';
import { ERROR_KEYS } from '@/i18n/error-keys';

// This suite exists because the migration rewrites library files in place and its bookkeeping
// fails silently: a title left claimed after a worker crash refuses every acquisition forever, a
// late worker report overwriting BUSY or MISSING hides a skipped file, a duplicate report counted
// twice stops the run from ever reading COMPLETED (and then every new run is refused), and a
// media-server failure downgrading MIGRATED would re-run files that were already rewritten. The
// prisma double evaluates the real `where` clauses on in-memory rows, so a dropped guard fails here.
type Item = {
  id: number;
  migrationId: number;
  movieId: number | null;
  episodeId: number | null;
  claimedAt: Date | null;
  outcome: string | null;
  reasonKey: string | null;
  hostPath: string | null;
  settledAt: Date | null;
};
type Run = {
  id: number;
  status: 'RUNNING' | 'COMPLETED';
  total: number;
  processed: number;
  migrated: number;
  unchanged: number;
  busy: number;
  missing: number;
  failed: number;
  startedAt: Date;
  finishedAt: Date | null;
};

const matchesItem = (item: Item, where: Record<string, any>): boolean => {
  if (where.id !== undefined && item.id !== where.id) return false;
  if (where.migrationId !== undefined) {
    const want = where.migrationId;
    if (typeof want === 'object' ? !want.in.includes(item.migrationId) : item.migrationId !== want) {
      return false;
    }
  }
  if ('outcome' in where && item.outcome !== where.outcome) return false;
  return true;
};

describe('LibraryTagsService', () => {
  let items: Item[];
  let runs: Run[];
  let movies: Array<{ id: number; tmdbId: number; filePath: string | null; mediaServerPresentAt: Date | null }>;
  let busy: { jobs: number; embeds: number; searches: number };
  let deliveringJob: { ffmpegCommand: string | null; updatedAt: Date } | null;
  let enqueue: jest.Mock;
  let locate: jest.Mock;
  let createClient: jest.Mock;
  let prisma: any;
  let service: LibraryTagsService;

  beforeEach(() => {
    items = [];
    runs = [];
    movies = [{ id: 1, tmdbId: 10, filePath: '/lib/a.mkv', mediaServerPresentAt: null }];
    busy = { jobs: 0, embeds: 0, searches: 0 };
    deliveringJob = null;
    enqueue = jest.fn().mockResolvedValue(undefined);
    locate = jest.fn();
    createClient = jest.fn().mockResolvedValue(null);

    prisma = {
      libraryTagMigration: {
        findFirst: jest.fn(async () => runs[runs.length - 1] ?? null),
        count: jest.fn(async ({ where }) => runs.filter((r) => r.status === where.status).length),
        create: jest.fn(async ({ data }) => {
          const run: Run = {
            id: runs.length + 1, status: 'RUNNING', total: 0, processed: 0, migrated: 0,
            unchanged: 0, busy: 0, missing: 0, failed: 0, startedAt: new Date(), finishedAt: null,
            ...data,
          };
          runs.push(run);
          return run;
        }),
        findMany: jest.fn(async ({ where }) => runs.filter((r) => r.status === where.status)),
        update: jest.fn(async ({ where, data }) => {
          const run = runs.find((r) => r.id === where.id)!;
          for (const [key, value] of Object.entries<any>(data)) {
            (run as any)[key] = value && typeof value === 'object' && 'increment' in value
              ? (run as any)[key] + value.increment
              : value;
          }
          return run;
        }),
        updateMany: jest.fn(async ({ where, data }) => {
          const hit = runs.filter((r) => r.id === where.id && r.status === where.status);
          hit.forEach((r) => Object.assign(r, data));
          return { count: hit.length };
        }),
      },
      libraryTagMigrationItem: {
        createMany: jest.fn(async ({ data }) => {
          for (const row of data) {
            items.push({
              id: items.length + 1, movieId: null, episodeId: null, claimedAt: null,
              outcome: null, reasonKey: null, hostPath: null, settledAt: null, ...row,
            });
          }
        }),
        findMany: jest.fn(async ({ where }) => items.filter((i) => matchesItem(i, where))),
        findUnique: jest.fn(async ({ where }) => {
          const item = items.find((i) => i.id === where.id);
          if (!item) return null;
          return { ...item, movie: movies.find((m) => m.id === item.movieId) ?? null, episode: null };
        }),
        findUniqueOrThrow: jest.fn(async ({ where }) => items.find((i) => i.id === where.id)),
        count: jest.fn(async ({ where }) => items.filter((i) => matchesItem(i, where)).length),
        updateMany: jest.fn(async ({ where, data }) => {
          const hit = items.filter((i) => matchesItem(i, where));
          hit.forEach((i) => Object.assign(i, data));
          return { count: hit.length };
        }),
      },
      movie: {
        findMany: jest.fn(async () => movies),
        findUnique: jest.fn(async ({ where }) => movies.find((m) => m.id === where.id) ?? null),
      },
      episode: { findMany: jest.fn(async () => []), findUnique: jest.fn() },
      processJob: {
        count: jest.fn(async () => busy.jobs),
        findFirst: jest.fn(async () => deliveringJob),
      },
      subtitleEmbed: {
        count: jest.fn(async () => busy.embeds),
        findMany: jest.fn(async () => []),
      },
      subtitleSearch: { count: jest.fn(async () => busy.searches) },
      subtitleSearchAttempt: { findMany: jest.fn(async () => []) },
    };

    service = new LibraryTagsService(
      prisma as never,
      { enqueue } as never,
      { locate } as never,
      { createClient } as never,
      {
        containerToHostPath: (_root: string, p: string) => `/host${p}`,
        hostToContainerPath: (_root: string, p: string) => p.replace('/host', ''),
      } as never,
    );
  });

  const keyOf = (error: unknown) =>
    ((error as HttpException).getResponse() as { i18n: { key: string } }).i18n.key;

  it('refuses a second start while a run is RUNNING and creates nothing', async () => {
    await service.start();

    const error = await service.start().catch((e) => e);

    expect(keyOf(error)).toBe(ERROR_KEYS.LIBRARY_TAGS_MIGRATION_RUNNING);
    expect(runs).toHaveLength(1);
  });

  it('settles a busy title as BUSY and answers item_settled', async () => {
    await service.start();
    busy.embeds = 1;

    const error = await service.claim(1).catch((e) => e);

    expect(keyOf(error)).toBe(ERROR_KEYS.LIBRARY_TAGS_ITEM_SETTLED);
    expect(items[0]).toMatchObject({ outcome: 'BUSY', claimedAt: null });
    expect(runs[0]).toMatchObject({ busy: 1, processed: 1 });
  });

  it('settles a title with no resolvable path as MISSING', async () => {
    movies[0].filePath = null;
    movies[0].mediaServerPresentAt = new Date();
    locate.mockResolvedValue({ reason: 'not_held' });
    await service.start();

    const error = await service.claim(1).catch((e) => e);

    expect(keyOf(error)).toBe(ERROR_KEYS.LIBRARY_TAGS_ITEM_SETTLED);
    expect(items[0]).toMatchObject({
      outcome: 'MISSING',
      reasonKey: ERROR_KEYS.LIBRARY_TAGS_FILE_MISSING,
    });
  });

  it('answers item_not_found for an unknown id', async () => {
    const error = await service.claim(99).catch((e) => e);

    expect(keyOf(error)).toBe(ERROR_KEYS.LIBRARY_TAGS_ITEM_NOT_FOUND);
  });

  it('claims a free title, stamps the claim and returns the container path', async () => {
    await service.start();

    const details = await service.claim(1);

    expect(details).toMatchObject({ id: 1, filePath: '/lib/a.mkv', tracks: [] });
    expect(items[0].claimedAt).not.toBeNull();
    expect(items[0].hostPath).toBe('/host/lib/a.mkv');
  });

  it('sends a legacy provider-prefixed track source as the bare name', async () => {
    prisma.subtitleEmbed.findMany.mockResolvedValue([
      {
        finishedAt: new Date(),
        tracks: [
          { provenance: 'subdivx:Movie.es.srt', stagedPath: '/x' },
          { provenance: 'Other.en.srt', stagedPath: '/y' },
        ],
      },
    ]);
    prisma.subtitleSearchAttempt.findMany.mockResolvedValue([
      { providerFileName: 'subdivx:Movie.es.srt', provider: 'SUBDIVX', providerSubtitleId: '1', score: 1, framerateRatio: 1 },
      { providerFileName: 'Other.en.srt', provider: 'OPENSUBTITLES', providerSubtitleId: '2', score: 2, framerateRatio: 1 },
    ]);
    await service.start();

    const details = await service.claim(1);

    expect(details.tracks.map((t) => [t.source, t.provider])).toEqual([
      ['Movie.es.srt', 'subdivx'],
      ['Other.en.srt', 'opensubtitles'],
    ]);
  });

  describe('encode facts from the stored command', () => {
    const SVT = '-svtav1-params tune=0:scm=0';
    const claimWith = async (ffmpegCommand: string | null) => {
      deliveringJob = ffmpegCommand === undefined ? null : { ffmpegCommand, updatedAt: new Date() };
      await service.start();
      return service.claim(1);
    };

    it('reports grainApplied true for a command with film-grain above zero', async () => {
      const d = await claimWith(`ffmpeg -i in.mkv -c:v libsvtav1 -crf 22 -preset 4 ${SVT}:film-grain=8:film-grain-denoise=1 out.mkv`);

      expect(d.grainApplied).toBe(true);
      expect(d.deinterlaced).toBeNull();
    });

    it('reports null for both when the video is stream-copied', async () => {
      const d = await claimWith('ffmpeg -i in.mkv -c:v copy out.mkv');

      expect(d.grainApplied).toBeNull();
      expect(d.deinterlaced).toBeNull();
    });

    it('reports deinterlaced true for a bwdif filter chain', async () => {
      const d = await claimWith(`ffmpeg -i in.mkv -vf bwdif=mode=send_frame:parity=tff:deint=interlaced,scale=854:480 -c:v libsvtav1 -crf 24 -preset 4 ${SVT}:film-grain=0 out.mkv`);

      expect(d.deinterlaced).toBe(true);
      expect(d.grainApplied).toBe(false);
    });

    it('reports null for both when no delivering job exists', async () => {
      const d = await claimWith(undefined as unknown as string);

      expect(d.grainApplied).toBeNull();
      expect(d.deinterlaced).toBeNull();
    });
  });

  it('ignores a late worker report after the item was settled BUSY', async () => {
    await service.start();
    busy.jobs = 1;
    await service.claim(1).catch(() => undefined);

    await expect(service.finish(1, LibraryTagOutcome.MIGRATED, null)).resolves.toBe(true);

    expect(items[0].outcome).toBe('BUSY');
    expect(runs[0]).toMatchObject({ migrated: 0, busy: 1, processed: 1 });
  });

  it('counts a duplicate report once', async () => {
    movies.push({ id: 2, tmdbId: 11, filePath: '/lib/b.mkv', mediaServerPresentAt: null });
    await service.start();
    await service.claim(1);

    await service.finish(1, LibraryTagOutcome.UNCHANGED, null);
    await service.finish(1, LibraryTagOutcome.UNCHANGED, null);

    expect(runs[0]).toMatchObject({ unchanged: 1, processed: 1, status: 'RUNNING' });
  });

  it('completes the run when the last item settles', async () => {
    await service.start();
    await service.claim(1);

    await service.finish(1, LibraryTagOutcome.FAILED, ERROR_KEYS.LIBRARY_TAGS_WRITE_FAILED);

    expect(runs[0].status).toBe('COMPLETED');
    expect(runs[0].finishedAt).not.toBeNull();
    expect(runs[0]).toMatchObject({ failed: 1, processed: 1, total: 1 });
    await expect(service.start()).resolves.toMatchObject({ id: 2 });
  });

  it('clears claims and re-enqueues unsettled items on worker boot', async () => {
    movies.push({ id: 2, tmdbId: 11, filePath: '/lib/b.mkv', mediaServerPresentAt: null });
    await service.start();
    await service.claim(1);
    await service.finish(2, LibraryTagOutcome.UNCHANGED, null);
    enqueue.mockClear();

    await service.requeueAfterWorkerBoot();

    expect(items[0].claimedAt).toBeNull();
    expect(enqueue.mock.calls).toEqual([[1]]);
  });

  it('keeps MIGRATED when notifying the media server fails', async () => {
    createClient.mockRejectedValue(new Error('down'));
    await service.start();
    await service.claim(1);

    await expect(service.finish(1, LibraryTagOutcome.MIGRATED, null)).resolves.toBe(true);

    expect(items[0].outcome).toBe('MIGRATED');
    expect(createClient).toHaveBeenCalled();
    expect(runs[0]).toMatchObject({ migrated: 1, status: 'COMPLETED' });
  });
});
