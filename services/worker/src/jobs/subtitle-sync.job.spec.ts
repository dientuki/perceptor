// Defends against a silent failure: an ffsubsync crash or timeout reported as a measurement
// (or not reported at all, leaving the search RUNNING), a leaked temp directory, the staged
// candidate deleted by the worker, or a report sent for an attempt api no longer owns.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  events: [] as string[],
  details: vi.fn(),
  started: vi.fn(),
  completed: vi.fn(),
  failed: vi.fn(),
  capture: vi.fn(),
  metadata: vi.fn(),
  chapters: vi.fn(),
  tempDirs: [] as string[],
}));

vi.mock('../api/subtitle-sync-reports', () => ({
  subtitleSyncDetails: (...a: unknown[]) => h.details(...a),
  subtitleSyncStarted: (...a: unknown[]) => h.started(...a),
  subtitleSyncCompleted: (...a: unknown[]) => h.completed(...a),
  subtitleSyncFailed: (...a: unknown[]) => h.failed(...a),
}));
vi.mock('../ffmpeg/capture', () => ({
  runFfmpegCapture: (...a: unknown[]) => h.capture(...a),
}));
vi.mock('../ffmpeg/metadata', () => ({
  getMetadata: (...a: unknown[]) => h.metadata(...a),
}));
vi.mock('../subtitles/chapters', async () => {
  const actual = await vi.importActual<typeof import('../subtitles/chapters')>('../subtitles/chapters');
  return { ...actual, probeChapters: (...a: unknown[]) => h.chapters(...a) };
});
vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    rm: (...args: Parameters<typeof actual.rm>) => {
      h.events.push(`rm:${String(args[0])}`);
      return actual.rm(...args);
    },
    unlink: (...args: Parameters<typeof actual.unlink>) => {
      h.events.push(`unlink:${String(args[0])}`);
      return actual.unlink(...args);
    },
    mkdtemp: async (...args: Parameters<typeof actual.mkdtemp>) => {
      const dir = await actual.mkdtemp(...args);
      h.tempDirs.push(dir);
      return dir;
    },
  };
});

import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Job } from 'bullmq';
import { handleSubtitleSync } from './subtitle-sync.job';
import type { SubtitleSyncJob } from '../queue/types';
import { KeyedError } from '../i18n/keyed-error';

const LOG = [
  'INFO offset seconds: -2.0',
  'INFO framerate scale factor: 1.0',
  'INFO score: 1234.5',
].join('\n');
const SUB = { codec_type: 'subtitle', codec_name: 'subrip', disposition: {} };

const job = { data: { subtitleSyncId: 5 } } as Job<SubtitleSyncJob>;
const exists = (p: string) => stat(p).then(() => true, () => false);

let dir: string;
let candidate: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sync-job-spec-'));
  candidate = join(dir, 'candidate.srt');
  await writeFile(candidate, 'x');
  h.events.length = 0;
  h.tempDirs.length = 0;
  h.details.mockReset().mockResolvedValue({ id: 5, filePath: join(dir, 'Film.mkv'), candidatePath: candidate });
  h.started.mockReset().mockResolvedValue(true);
  h.completed.mockReset().mockResolvedValue(true);
  h.failed.mockReset().mockResolvedValue(true);
  h.metadata.mockReset().mockResolvedValue({ metadata: { streams: [SUB], format: { duration: '7265.4321' } }, raw: '' });
  h.chapters.mockReset().mockResolvedValue([]);
  h.capture.mockReset().mockResolvedValue({ code: 0, stdoutBytes: 0, stderr: LOG });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

describe('handleSubtitleSync', () => {
  it('reports the measurements and removes the temp directory on success', async () => {
    await handleSubtitleSync(job);

    expect(h.completed).toHaveBeenCalledWith(5, -2000, 1, 'SUBTITLE', 1234.5, 7265432, null);
    expect(h.failed).not.toHaveBeenCalled();
    expect(await Promise.all(h.tempDirs.map(exists))).toEqual([false]);
    expect(await exists(candidate)).toBe(true);
  });

  it('passes the vad flag only for an audio reference', async () => {
    h.metadata.mockResolvedValue({ metadata: { streams: [{ codec_type: 'audio', disposition: {} }], format: { duration: '7265.4321' } }, raw: '' });
    await handleSubtitleSync(job);

    const [args] = h.capture.mock.calls[0];
    expect(args).toContain('--vad');
    expect(args).toContain('a:0');
    expect(h.completed).toHaveBeenCalledWith(5, -2000, 1, 'AUDIO', 1234.5, 7265432, null);
  });

  it('reports sync_failed on ffsubsync exit 1 and removes the temp directory', async () => {
    h.capture.mockResolvedValue({ code: 1, stdoutBytes: 0, stderr: 'boom' });
    await handleSubtitleSync(job);

    expect(h.failed).toHaveBeenCalledWith(5, 'error.subtitleSearch.sync_failed');
    expect(h.completed).not.toHaveBeenCalled();
    expect(await Promise.all(h.tempDirs.map(exists))).toEqual([false]);
    expect(await exists(candidate)).toBe(true);
  });

  it('reports sync_failed when the log cannot be parsed', async () => {
    h.capture.mockResolvedValue({ code: 0, stdoutBytes: 0, stderr: 'INFO score: 1' });
    await handleSubtitleSync(job);

    expect(h.failed).toHaveBeenCalledWith(5, 'error.subtitleSearch.sync_failed');
    expect(h.completed).not.toHaveBeenCalled();
    expect(await Promise.all(h.tempDirs.map(exists))).toEqual([false]);
  });

  it('reports sync_failed when the run is killed', async () => {
    h.capture.mockRejectedValue(new Error('killed'));
    await handleSubtitleSync(job);

    expect(h.failed).toHaveBeenCalledWith(5, 'error.subtitleSearch.sync_failed');
    expect(await Promise.all(h.tempDirs.map(exists))).toEqual([false]);
  });

  it('reports sync_failed without running ffsubsync when there is no reference stream', async () => {
    h.metadata.mockResolvedValue({ metadata: { streams: [] }, raw: '' });
    await handleSubtitleSync(job);

    expect(h.capture).not.toHaveBeenCalled();
    expect(h.failed).toHaveBeenCalledWith(5, 'error.subtitleSearch.sync_failed');
  });

  it('reports the last chapter start in milliseconds from a fixture with chapters', async () => {
    h.chapters.mockResolvedValue([{ start_time: '0.000000' }, { start_time: '3600.000000' }, { start_time: '7100.5' }]);
    await handleSubtitleSync(job);

    expect(h.completed).toHaveBeenCalledWith(5, -2000, 1, 'SUBTITLE', 1234.5, 7265432, 7100500);
  });

  it('reports a null last chapter with a single chapter', async () => {
    h.chapters.mockResolvedValue([{ start_time: '0.000000' }]);
    await handleSubtitleSync(job);

    expect(h.completed).toHaveBeenCalledWith(5, -2000, 1, 'SUBTITLE', 1234.5, 7265432, null);
  });

  it.each([
    ['missing', { streams: [SUB] }],
    ['unparseable', { streams: [SUB], format: { duration: 'N/A' } }],
  ])('reports sync_failed when the duration is %s', async (_n, metadata) => {
    h.metadata.mockResolvedValue({ metadata, raw: '' });
    await handleSubtitleSync(job);

    expect(h.capture).not.toHaveBeenCalled();
    expect(h.completed).not.toHaveBeenCalled();
    expect(h.failed).toHaveBeenCalledWith(5, 'error.subtitleSearch.sync_failed');
  });

  it('never deletes the staged candidate on any branch', async () => {
    await handleSubtitleSync(job);
    h.capture.mockResolvedValue({ code: 1, stdoutBytes: 0, stderr: '' });
    await handleSubtitleSync(job);

    expect(h.events.filter((e) => e.includes(candidate))).toEqual([]);
    expect(await exists(candidate)).toBe(true);
  });

  it('reports nothing and runs nothing when started answers false', async () => {
    h.started.mockResolvedValue(false);
    await handleSubtitleSync(job);

    expect(h.capture).not.toHaveBeenCalled();
    expect(h.completed).not.toHaveBeenCalled();
    expect(h.failed).not.toHaveBeenCalled();
    expect(h.tempDirs).toEqual([]);
  });

  it('abandons with no report when the search no longer exists', async () => {
    h.details.mockRejectedValue(
      new KeyedError('error.subtitleSearch.sync_not_found', 'gone'),
    );
    await handleSubtitleSync(job);

    expect(h.started).not.toHaveBeenCalled();
    expect(h.completed).not.toHaveBeenCalled();
    expect(h.failed).not.toHaveBeenCalled();
  });

  it('rethrows any other details error', async () => {
    h.details.mockRejectedValue(new Error('graphql down'));
    await expect(handleSubtitleSync(job)).rejects.toThrow('graphql down');
  });
});
