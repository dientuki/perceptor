// Defends against a silent failure: an in-place tag rewrite that writes when it should not
// (unwritable file, nothing to change), keeps writing after a verification mismatch, reports
// success for a write that failed, or leaves temp XML behind in the OS temp directory.

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  item: vi.fn(),
  finished: vi.fn(),
  metadata: vi.fn(),
  merge: vi.fn(),
  exec: vi.fn(),
}));

vi.mock('../api/library-tags-reports', () => ({
  libraryTagMigrationItem: (...a: unknown[]) => h.item(...a),
  libraryTagMigrationItemFinished: (...a: unknown[]) => h.finished(...a),
}));
vi.mock('../ffmpeg/metadata', () => ({ getMetadata: (...a: unknown[]) => h.metadata(...a) }));
vi.mock('../tags/merge-library-tags', () => ({ mergeLibraryTags: (...a: unknown[]) => h.merge(...a) }));
vi.mock('node:child_process', () => ({
  execFile: (bin: string, args: string[], _opts: unknown, cb: (e: unknown, o: string, s: string) => void) => {
    h.exec(bin, args)
      .then((r: { code?: number; stdout?: string; stderr?: string }) => {
        const code = r.code ?? 0;
        if (code === 0) cb(null, r.stdout ?? '', r.stderr ?? '');
        else cb(Object.assign(new Error('failed'), { code }), r.stdout ?? '', r.stderr ?? '');
      })
      .catch((e: unknown) => cb(e, '', ''));
  },
}));

import { mkdtemp, readdir, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Job } from 'bullmq';
import { handleLibraryTags } from './library-tags.job';
import type { LibraryTagsJob } from '../queue/types';
import { KeyedError } from '../i18n/keyed-error';

const asJob = (itemId: number) => ({ data: { itemId } }) as Job<LibraryTagsJob>;
const probe = (title = 'Spanish') => ({
  metadata: {
    format: { duration: '100.0' },
    streams: [
      { codec_type: 'video', codec_name: 'av1', width: 1920, height: 1080 },
      { codec_type: 'audio', codec_name: 'opus', tags: { language: 'spa', title } },
    ],
  },
  raw: '',
});
const details = (filePath: string) => ({ id: 7, filePath, tracks: [] });
const tempEntries = async () =>
  (await readdir(tmpdir())).filter((n) => n.startsWith('perceptor-library-tags-'));
const calls = (bin: string) => h.exec.mock.calls.filter((c) => c[0] === bin);

let dir: string;
let filePath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'library-tags-spec-'));
  filePath = join(dir, 'Film (2020).mkv');
  await writeFile(filePath, 'x');
  h.item.mockReset().mockResolvedValue(details(filePath));
  h.finished.mockReset().mockResolvedValue(true);
  h.metadata.mockReset().mockResolvedValue(probe());
  h.merge.mockReset().mockReturnValue('<Tags></Tags>');
  h.exec.mockReset().mockImplementation(async (bin: string) => {
    if (bin === 'mkvmerge') {
      return { stdout: JSON.stringify({ tracks: [{ type: 'video', properties: { number: 1, uid: 11 } }] }) };
    }
    return { stdout: '' };
  });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await chmod(filePath, 0o644).catch(() => undefined);
  await rm(dir, { recursive: true, force: true });
});

describe('library tags job', () => {
  it.each(['error.libraryTags.item_settled', 'error.libraryTags.item_not_found'])(
    'reports nothing and does not throw for %s',
    async (key) => {
      h.item.mockRejectedValue(new KeyedError(key, 'x'));
      await handleLibraryTags(asJob(7));
      expect(h.finished).not.toHaveBeenCalled();
      expect(h.exec).not.toHaveBeenCalled();
    },
  );

  it('rethrows any other details error so BullMQ retries', async () => {
    h.item.mockRejectedValue(new Error('boom'));
    await expect(handleLibraryTags(asJob(7))).rejects.toThrow('boom');
    expect(h.finished).not.toHaveBeenCalled();
  });

  it('reports MISSING for a file that does not exist', async () => {
    await rm(filePath);
    await handleLibraryTags(asJob(7));
    expect(h.finished).toHaveBeenCalledWith(7, 'MISSING', 'error.libraryTags.file_missing');
    expect(h.exec).not.toHaveBeenCalled();
  });

  it.skipIf(process.getuid?.() === 0)(
    'reports write_failed without spawning mkvpropedit for an unwritable file',
    async () => {
      await chmod(filePath, 0o444);
      await handleLibraryTags(asJob(7));
      expect(h.finished).toHaveBeenCalledWith(7, 'FAILED', 'error.libraryTags.write_failed');
      expect(calls('mkvpropedit')).toHaveLength(0);
    },
  );

  it('reports write_failed without spawning mkvpropedit when the first probe fails', async () => {
    h.metadata.mockRejectedValue(new Error('ffprobe died'));
    await handleLibraryTags(asJob(7));
    expect(h.finished).toHaveBeenCalledWith(7, 'FAILED', 'error.libraryTags.write_failed');
    expect(calls('mkvpropedit')).toHaveLength(0);
  });

  it('reports UNCHANGED with no write when the merge has nothing to do', async () => {
    h.merge.mockReturnValue('unchanged');
    await handleLibraryTags(asJob(7));
    expect(h.finished).toHaveBeenCalledWith(7, 'UNCHANGED', null);
    expect(calls('mkvpropedit')).toHaveLength(0);
  });

  it('reports write_failed when mkvpropedit exits non-zero', async () => {
    h.exec.mockImplementation(async (bin: string) => {
      if (bin === 'mkvpropedit') return { code: 2, stderr: 'nope' };
      if (bin === 'mkvmerge') return { stdout: JSON.stringify({ tracks: [] }) };
      return {};
    });
    await handleLibraryTags(asJob(7));
    expect(h.finished).toHaveBeenCalledWith(7, 'FAILED', 'error.libraryTags.write_failed');
    expect(calls('mkvpropedit')).toHaveLength(1);
  });

  it('reports verify_failed and writes only once when the re-probe differs', async () => {
    h.metadata.mockResolvedValueOnce(probe('Spanish')).mockResolvedValueOnce(probe('Other'));
    await handleLibraryTags(asJob(7));
    expect(h.finished).toHaveBeenCalledWith(7, 'FAILED', 'error.libraryTags.verify_failed');
    expect(calls('mkvpropedit')).toHaveLength(1);
  });

  it('passes a 64-bit track UID to the merge as exact digits', async () => {
    h.exec.mockImplementation(async (bin: string) =>
      bin === 'mkvmerge'
        ? { stdout: '{"tracks":[{"type":"video","properties":{"number":1,"uid":18234047073334910123}}]}' }
        : { stdout: '' },
    );
    await handleLibraryTags(asJob(7));
    expect(h.merge.mock.calls[0][0].tracks).toEqual([{ number: 1, uid: '18234047073334910123', type: 'video' }]);
  });

  it('reports MIGRATED when the re-probe matches, with the tracks and their types passed to the merge', async () => {
    await handleLibraryTags(asJob(7));
    expect(h.finished).toHaveBeenCalledWith(7, 'MIGRATED', null);
    expect(h.merge.mock.calls[0][0].tracks).toEqual([{ number: 1, uid: '11', type: 'video' }]);
    const edit = calls('mkvpropedit')[0][1] as string[];
    expect(edit[0]).toBe(filePath);
    expect(edit[1]).toBe('--tags');
    expect(edit[2].startsWith('all:')).toBe(true);
    expect(edit[2].includes(dir)).toBe(false);
  });

  it('passes no version to the merge, so a migrated group can never carry VERSION', async () => {
    process.env.PERCEPTOR_VERSION = '9.9.9';
    try {
      await handleLibraryTags(asJob(7));
    } finally {
      delete process.env.PERCEPTOR_VERSION;
    }
    expect(h.merge.mock.calls[0][0]).not.toHaveProperty('version');
  });

  it('writes nothing into the library folder besides the file itself', async () => {
    await handleLibraryTags(asJob(7));
    expect(await readdir(dir)).toEqual(['Film (2020).mkv']);
  });

  it('removes its temp directory on every path', async () => {
    const before = await tempEntries();
    await handleLibraryTags(asJob(7));
    h.merge.mockReturnValue('unchanged');
    await handleLibraryTags(asJob(7));
    h.merge.mockReturnValue('<Tags></Tags>');
    h.exec.mockImplementation(async (bin: string) =>
      bin === 'mkvpropedit' ? { code: 2 } : { stdout: JSON.stringify({ tracks: [] }) },
    );
    await handleLibraryTags(asJob(7));
    h.exec.mockImplementation(async () => {
      throw new Error('spawn ENOENT');
    });
    await handleLibraryTags(asJob(7));
    expect(await tempEntries()).toEqual(before);
  });
});
