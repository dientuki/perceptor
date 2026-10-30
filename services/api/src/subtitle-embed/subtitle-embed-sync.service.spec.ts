import { HttpException } from '@nestjs/common';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ERROR_KEYS } from '@/i18n/error-keys';
import type { RejectionKey } from '@/subtitle-search/acceptance';
import {
  REJECTION_TO_EMBED_KEY,
  SubtitleEmbedSyncService,
  SyncReport,
} from './subtitle-embed-sync.service';

// This suite exists because a SYNCING embed that never leaves SYNCING keeps
// the title busy forever with no error anywhere; because an accepted
// measurement that flips the row before every automatic track is measured
// remuxes the file with offset 0 on the unmeasured ones; because one rejected
// track that does not fail the whole embed lets an out-of-sync subtitle into
// the file; and because a search rejection key leaking onto an embed row has
// no translation in the dialog. It runs against the real acceptance rule and a
// real sidecar on disk, with only Prisma and the queues faked (Article IX,
// Spec 113, REQ-3 REQ-4 REQ-5 NFR-2).
describe('SubtitleEmbedSyncService', () => {
  type Row = {
    id: number;
    status: string;
    filePath: string;
    errorKey: string | null;
    finishedAt: Date | null;
    tracks: Record<string, unknown>[];
  };

  let dir: string;
  let row: Row | null;
  let prisma: {
    subtitleEmbed: {
      findUnique: jest.Mock;
      updateMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let syncQueue: { addEmbedSync: jest.Mock };
  let embedQueue: { addEmbed: jest.Mock };
  let service: SubtitleEmbedSyncService;

  const good: SyncReport = {
    offsetMs: -2000,
    framerateRatio: 1,
    reference: 'SUBTITLE',
    score: 200_000,
    mediaDurationMs: 100_000,
    lastChapterStartMs: null,
  };

  const track = (fileName: string, over: Record<string, unknown> = {}) => ({
    fileName,
    languageIso3: 'spa',
    offsetMs: 0,
    autoOffset: true,
    ...over,
  });

  async function keyOf(promise: Promise<unknown>): Promise<string | undefined> {
    try {
      await promise;
    } catch (error) {
      return (
        (error as HttpException).getResponse() as { i18n?: { key: string } }
      ).i18n?.key;
    }
    return undefined;
  }

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'embed-sync-spec-'));
    const cue = '1\n00:01:20,000 --> 00:01:30,000\nhi\n';
    await writeFile(join(dir, 'a.srt'), cue);
    await writeFile(join(dir, 'b.srt'), cue);
    await writeFile(
      join(dir, 'utf16.srt'),
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(cue, 'utf16le')]),
    );
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    row = {
      id: 5,
      status: 'SYNCING',
      filePath: join(dir, 'Movie.mkv'),
      errorKey: null,
      finishedAt: null,
      tracks: [track('a.srt')],
    };
    prisma = {
      subtitleEmbed: {
        findUnique: jest
          .fn()
          .mockImplementation(() =>
            Promise.resolve(row && structuredClone(row)),
          ),
        updateMany: jest
          .fn()
          .mockImplementation(
            ({ where, data }: { where: { status: string }; data: object }) => {
              if (!row || row.status !== where.status) {
                return Promise.resolve({ count: 0 });
              }
              Object.assign(row, data);
              return Promise.resolve({ count: 1 });
            },
          ),
      },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(
      (callback: (tx: unknown) => Promise<unknown>) => callback(prisma),
    );
    syncQueue = { addEmbedSync: jest.fn().mockResolvedValue(undefined) };
    embedQueue = { addEmbed: jest.fn().mockResolvedValue(undefined) };
    service = new SubtitleEmbedSyncService(
      prisma as never,
      syncQueue as never,
      embedQueue as never,
    );
  });

  describe('completed', () => {
    it('flips a single accepted track to QUEUED, stores the measured offset and queues the remux once', async () => {
      await expect(service.completed(5, 'a.srt', good)).resolves.toBe(true);

      expect(row!.status).toBe('QUEUED');
      expect(row!.tracks[0].offsetMs).toBe(-2000);
      expect(embedQueue.addEmbed).toHaveBeenCalledTimes(1);
      expect(embedQueue.addEmbed).toHaveBeenCalledWith({ subtitleEmbedId: 5 });
    });

    it('flips only after the second of two automatic tracks is accepted', async () => {
      row!.tracks = [track('a.srt'), track('b.srt')];

      await service.completed(5, 'a.srt', good);
      expect(row!.status).toBe('SYNCING');
      expect(embedQueue.addEmbed).not.toHaveBeenCalled();

      await service.completed(5, 'b.srt', { ...good, offsetMs: 300 });
      expect(row!.status).toBe('QUEUED');
      expect(row!.tracks.map((t) => t.offsetMs)).toEqual([-2000, 300]);
      expect(embedQueue.addEmbed).toHaveBeenCalledTimes(1);
    });

    it('does not wait for a manual track of a mixed embed', async () => {
      row!.tracks = [track('a.srt'), track('b.srt', { autoOffset: false })];

      await service.completed(5, 'a.srt', good);

      expect(row!.status).toBe('QUEUED');
    });

    it('fails the whole embed on a rejection, never queues the remux and ignores later reports', async () => {
      row!.tracks = [track('a.srt'), track('b.srt')];

      await service.completed(5, 'a.srt', { ...good, score: 1 });
      expect(row!.status).toBe('FAILED');
      expect(row!.errorKey).toBe(ERROR_KEYS.SUBTITLE_EMBED_SYNC_LOW_SCORE);
      expect(row!.finishedAt).toBeInstanceOf(Date);

      await expect(service.completed(5, 'b.srt', good)).resolves.toBe(true);
      expect(row!.status).toBe('FAILED');
      expect(embedQueue.addEmbed).not.toHaveBeenCalled();
    });

    it('judges the last cue read from the sidecar, including a UTF-16 one', async () => {
      row!.tracks = [track('utf16.srt')];

      await service.completed(5, 'utf16.srt', good);

      expect(row!.status).toBe('QUEUED');
    });

    it('rejects as incomplete when the sidecar cannot be read', async () => {
      row!.tracks = [track('gone.srt')];

      await service.completed(5, 'gone.srt', good);

      expect(row!.errorKey).toBe(ERROR_KEYS.SUBTITLE_EMBED_SYNC_INCOMPLETE);
    });

    it('changes nothing for a duplicate report of a measured track', async () => {
      row!.tracks = [track('a.srt'), track('b.srt')];
      await service.completed(5, 'a.srt', good);
      prisma.subtitleEmbed.updateMany.mockClear();

      await expect(
        service.completed(5, 'a.srt', { ...good, offsetMs: 777 }),
      ).resolves.toBe(true);

      expect(prisma.subtitleEmbed.updateMany).not.toHaveBeenCalled();
      expect(row!.tracks[0].offsetMs).toBe(-2000);
    });

    it('answers true and writes nothing for a row that is no longer SYNCING', async () => {
      row!.status = 'FAILED';

      await expect(service.completed(5, 'a.srt', good)).resolves.toBe(true);

      expect(prisma.subtitleEmbed.updateMany).not.toHaveBeenCalled();
      expect(embedQueue.addEmbed).not.toHaveBeenCalled();
    });

    it('answers false for an unknown embed', async () => {
      row = null;
      await expect(service.completed(5, 'a.srt', good)).resolves.toBe(false);
    });

    it('ignores a file that is not an automatic track of the embed', async () => {
      await expect(service.completed(5, 'zzz.srt', good)).resolves.toBe(true);
      expect(prisma.subtitleEmbed.updateMany).not.toHaveBeenCalled();
    });

    it('ends FAILED/sync_failed when the remux cannot be queued after the flip', async () => {
      embedQueue.addEmbed.mockRejectedValue(new Error('redis down'));

      await expect(service.completed(5, 'a.srt', good)).resolves.toBe(true);

      expect(row!.status).toBe('FAILED');
      expect(row!.errorKey).toBe(ERROR_KEYS.SUBTITLE_EMBED_SYNC_FAILED);
    });

    it('rethrows a lost serializable transaction so the worker retries the report', async () => {
      const lost = Object.assign(new Error('write conflict'), {
        code: 'P2034',
      });
      prisma.$transaction.mockRejectedValue(lost);

      await expect(service.completed(5, 'a.srt', good)).rejects.toBe(lost);
    });
  });

  describe('rejection mapping', () => {
    it.each(Object.keys(REJECTION_TO_EMBED_KEY) as RejectionKey[])(
      'maps %s to an embed key, never a search key',
      (rejection) => {
        const mapped = REJECTION_TO_EMBED_KEY[rejection];
        expect(mapped).toMatch(/^error\.subtitleEmbed\.sync_/);
      },
    );

    it('covers every rejection accept() can return', async () => {
      const cases: [SyncReport, string][] = [
        [
          { ...good, framerateRatio: 1.05 },
          ERROR_KEYS.SUBTITLE_EMBED_SYNC_FRAMERATE_MISMATCH,
        ],
        [
          { ...good, offsetMs: 700_000 },
          ERROR_KEYS.SUBTITLE_EMBED_SYNC_OFFSET_TOO_LARGE,
        ],
        [
          { ...good, mediaDurationMs: 10_000_000 },
          ERROR_KEYS.SUBTITLE_EMBED_SYNC_INCOMPLETE,
        ],
        [{ ...good, score: 0 }, ERROR_KEYS.SUBTITLE_EMBED_SYNC_LOW_SCORE],
      ];
      for (const [report, expected] of cases) {
        row!.status = 'SYNCING';
        row!.errorKey = null;
        row!.tracks = [track('a.srt')];
        await service.completed(5, 'a.srt', report);
        expect(row!.errorKey).toBe(expected);
      }
    });
  });

  describe('failed', () => {
    it('fails a SYNCING embed with sync_failed', async () => {
      await expect(
        service.failed(5, 'a.srt', ERROR_KEYS.SUBTITLE_EMBED_SYNC_FAILED),
      ).resolves.toBe(true);

      expect(row!.status).toBe('FAILED');
      expect(row!.errorKey).toBe(ERROR_KEYS.SUBTITLE_EMBED_SYNC_FAILED);
    });

    it('stores an unknown worker key as sync_failed', async () => {
      await service.failed(5, 'a.srt', 'error.whatever');

      expect(row!.errorKey).toBe(ERROR_KEYS.SUBTITLE_EMBED_SYNC_FAILED);
    });

    it('answers true without writing for a row that already left SYNCING, false for an unknown one', async () => {
      row!.status = 'QUEUED';
      await expect(service.failed(5, 'a.srt', 'x')).resolves.toBe(true);
      expect(prisma.subtitleEmbed.updateMany).not.toHaveBeenCalled();

      row = null;
      await expect(service.failed(5, 'a.srt', 'x')).resolves.toBe(false);
    });
  });

  describe('details', () => {
    it('answers the library file and the sidecar beside it', async () => {
      await expect(service.details(5, 'a.srt')).resolves.toEqual({
        subtitleEmbedId: 5,
        fileName: 'a.srt',
        filePath: join(dir, 'Movie.mkv'),
        candidatePath: join(dir, 'a.srt'),
      });
    });

    it('refuses a manual track, an unknown file and a non-SYNCING row', async () => {
      row!.tracks = [track('a.srt'), track('m.srt', { autoOffset: false })];
      expect(await keyOf(service.details(5, 'm.srt'))).toBe(
        ERROR_KEYS.SUBTITLE_EMBED_SYNC_NOT_FOUND,
      );
      expect(await keyOf(service.details(5, 'nope.srt'))).toBe(
        ERROR_KEYS.SUBTITLE_EMBED_SYNC_NOT_FOUND,
      );

      row!.status = 'QUEUED';
      expect(await keyOf(service.details(5, 'a.srt'))).toBe(
        ERROR_KEYS.SUBTITLE_EMBED_SYNC_NOT_FOUND,
      );
    });
  });

  describe('enqueue', () => {
    it('enqueues one measurement per automatic track, indexed by its position', async () => {
      await service.enqueue({
        id: 5,
        tracks: [
          track('a.srt'),
          track('m.srt', { autoOffset: false }),
          track('b.srt'),
        ],
      } as never);

      expect(syncQueue.addEmbedSync.mock.calls).toEqual([
        [{ subtitleEmbedId: 5, fileName: 'a.srt' }, 0],
        [{ subtitleEmbedId: 5, fileName: 'b.srt' }, 2],
      ]);
    });
  });
});
