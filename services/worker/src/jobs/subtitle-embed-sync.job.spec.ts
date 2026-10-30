// Defends against a measurement that ends with no report (leaving the embed SYNCING until the
// next worker boot), a verdict key sent by the worker, a leaked temp directory, and any file
// written or deleted beside the sidecar in the library directory.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  details: vi.fn(),
  completed: vi.fn(),
  failed: vi.fn(),
  capture: vi.fn(),
  metadata: vi.fn(),
  chapters: vi.fn(),
  tempDirs: [] as string[],
}));

vi.mock('../api/subtitle-embed-sync-reports', () => ({
  subtitleEmbedSyncDetails: (...a: unknown[]) => h.details(...a),
  subtitleEmbedSyncCompleted: (...a: unknown[]) => h.completed(...a),
  subtitleEmbedSyncFailed: (...a: unknown[]) => h.failed(...a),
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
    mkdtemp: async (...args: Parameters<typeof actual.mkdtemp>) => {
      const dir = await actual.mkdtemp(...args);
      h.tempDirs.push(dir);
      return dir;
    },
  };
});

import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Job } from 'bullmq';
import { handleSubtitleEmbedSync } from './subtitle-embed-sync.job';
import type { SubtitleEmbedSyncJob } from '../queue/types';
import { KeyedError } from '../i18n/keyed-error';

const LOG = [
  'INFO offset seconds: -2.0',
  'INFO framerate scale factor: 1.0',
  'INFO score: 1234.5',
].join('\n');
const SUB = { codec_type: 'subtitle', codec_name: 'subrip', disposition: {} };

const job = { data: { subtitleEmbedId: 7, fileName: 'Film.spa.srt' } } as Job<SubtitleEmbedSyncJob>;
const exists = (p: string) => stat(p).then(() => true, () => false);

let dir: string;
let candidate: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'embed-sync-job-spec-'));
  candidate = join(dir, 'Film.spa.srt');
  await writeFile(candidate, 'x');
  h.tempDirs.length = 0;
  h.details.mockReset().mockResolvedValue({
    subtitleEmbedId: 7,
    fileName: 'Film.spa.srt',
    filePath: join(dir, 'Film.mkv'),
    candidatePath: candidate,
  });
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

describe('handleSubtitleEmbedSync', () => {
  it('reports the raw measurement and leaves the sidecar directory untouched', async () => {
    await handleSubtitleEmbedSync(job);

    expect(h.details).toHaveBeenCalledWith(7, 'Film.spa.srt');
    expect(h.completed).toHaveBeenCalledWith(7, 'Film.spa.srt', -2000, 1, 'SUBTITLE', 1234.5, 7265432, null);
    expect(h.failed).not.toHaveBeenCalled();
    expect(await Promise.all(h.tempDirs.map(exists))).toEqual([false]);
    expect(await readdir(dir)).toEqual(['Film.spa.srt']);
  });

  it('reports only sync_failed when the measurement throws', async () => {
    h.capture.mockRejectedValue(new Error('killed'));
    await handleSubtitleEmbedSync(job);

    expect(h.failed).toHaveBeenCalledWith(7, 'Film.spa.srt', 'error.subtitleEmbed.sync_failed');
    expect(h.completed).not.toHaveBeenCalled();
    expect(await Promise.all(h.tempDirs.map(exists))).toEqual([false]);
    expect(await readdir(dir)).toEqual(['Film.spa.srt']);
  });

  it('reports sync_failed on a non-zero ffsubsync exit', async () => {
    h.capture.mockResolvedValue({ code: 1, stdoutBytes: 0, stderr: 'boom' });
    await handleSubtitleEmbedSync(job);

    expect(h.failed).toHaveBeenCalledWith(7, 'Film.spa.srt', 'error.subtitleEmbed.sync_failed');
    expect(await Promise.all(h.tempDirs.map(exists))).toEqual([false]);
    expect(await readdir(dir)).toEqual(['Film.spa.srt']);
  });

  it('reports nothing and measures nothing when the embed is no longer measuring', async () => {
    h.details.mockRejectedValue(new KeyedError('error.subtitleEmbed.sync_not_found', 'gone'));
    await handleSubtitleEmbedSync(job);

    expect(h.capture).not.toHaveBeenCalled();
    expect(h.completed).not.toHaveBeenCalled();
    expect(h.failed).not.toHaveBeenCalled();
    expect(h.tempDirs).toEqual([]);
    expect(await readdir(dir)).toEqual(['Film.spa.srt']);
  });

  it('rethrows any other details error', async () => {
    h.details.mockRejectedValue(new Error('graphql down'));
    await expect(handleSubtitleEmbedSync(job)).rejects.toThrow('graphql down');
    expect(h.failed).not.toHaveBeenCalled();
  });
});
