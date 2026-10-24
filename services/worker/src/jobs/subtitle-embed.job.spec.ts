// Defends against a silent failure: a job reported COMPLETED while the library file was
// never replaced, a sidecar deleted before the embed was durable, or a half-written
// ".part.mkv" or temp dir left behind.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  events: [] as string[],
  details: vi.fn(),
  started: vi.fn(),
  completed: vi.fn(),
  failed: vi.fn(),
  capture: vi.fn(),
  metadata: vi.fn(),
  tempDirs: [] as string[],
}));

vi.mock('../api/subtitle-embed-reports', () => ({
  subtitleEmbedDetails: (...a: unknown[]) => h.details(...a),
  subtitleEmbedStarted: (...a: unknown[]) => h.started(...a),
  subtitleEmbedCompleted: (...a: unknown[]) => h.completed(...a),
  subtitleEmbedFailed: (...a: unknown[]) => h.failed(...a),
}));
vi.mock('../ffmpeg/capture', () => ({
  runFfmpegCapture: (...a: unknown[]) => h.capture(...a),
}));
vi.mock('../ffmpeg/metadata', () => ({
  getMetadata: (...a: unknown[]) => h.metadata(...a),
}));
vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  const spy =
    <K extends keyof typeof actual>(name: K) =>
    (...args: unknown[]) => {
      h.events.push(`${String(name)}:${String(args[0])}`);
      return (actual[name] as (...a: unknown[]) => unknown)(...args);
    };
  return {
    ...actual,
    rm: spy('rm'),
    chmod: spy('chmod'),
    chown: spy('chown'),
    rename: spy('rename'),
    unlink: spy('unlink'),
    mkdtemp: async (...args: Parameters<typeof actual.mkdtemp>) => {
      const dir = await actual.mkdtemp(...args);
      h.tempDirs.push(dir);
      return dir;
    },
  };
});

import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Job } from 'bullmq';
import { handleSubtitleEmbed } from './subtitle-embed.job';
import type { SubtitleEmbedJob } from '../queue/types';

const SRT = '1\n00:00:01,000 --> 00:00:02,000\nHola\n';
const stream = (type: string, codec: string, lang: string, extra = {}) => ({
  codec_type: type,
  codec_name: codec,
  tags: { language: lang },
  disposition: {},
  ...extra,
});
const ORIGINAL = {
  streams: [stream('video', 'av1', 'und'), stream('audio', 'opus', 'eng')],
  format: { duration: '100' },
};
const RESULT = {
  streams: [...ORIGINAL.streams, stream('subtitle', 'subrip', 'spa')],
  format: { duration: '100.2' },
};

let dir: string;
let mkv: string;
let part: string;
let sidecar: string;

const job = { data: { subtitleEmbedId: 7 } } as Job<SubtitleEmbedJob>;
const exists = (p: string) => stat(p).then(() => true, () => false);
const tmpEmbedDirs = () => Promise.all(h.tempDirs.map(exists));

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'embed-job-spec-'));
  mkv = join(dir, 'Film.mkv');
  part = `${mkv}.part.mkv`;
  sidecar = join(dir, 'Film.spa.srt');
  await writeFile(mkv, 'ORIGINAL');
  await writeFile(sidecar, SRT);
  h.events.length = 0;
  h.tempDirs.length = 0;
  h.details.mockReset().mockResolvedValue({
    id: 7,
    filePath: mkv,
    tracks: [
      { sourcePath: sidecar, languageIso3: 'spa', trackTitle: 'Español', isDefault: false, isForced: false, offsetMs: 0 },
    ],
  });
  h.started.mockReset().mockResolvedValue(true);
  h.completed.mockReset().mockResolvedValue(true);
  h.failed.mockReset().mockResolvedValue(true);
  h.metadata.mockReset().mockImplementation(async (path: string) => ({
    metadata: path === mkv ? ORIGINAL : RESULT,
    raw: '',
  }));
  h.capture.mockReset().mockImplementation(async () => {
    await writeFile(part, 'EMBEDDED');
    return { code: 0, stdoutBytes: 0, stderr: '' };
  });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

describe('handleSubtitleEmbed', () => {
  it('removes the scratch part file before reporting started', async () => {
    await writeFile(part, 'STALE');
    h.started.mockImplementation(async () => {
      h.events.push('started');
      expect(await exists(part)).toBe(false);
      return true;
    });

    await handleSubtitleEmbed(job);

    expect(h.events.indexOf(`rm:${part}`)).toBeLessThan(h.events.indexOf('started'));
  });

  it('reports nothing and touches nothing when started answers false', async () => {
    h.started.mockResolvedValue(false);

    await handleSubtitleEmbed(job);

    expect(h.completed).not.toHaveBeenCalled();
    expect(h.failed).not.toHaveBeenCalled();
    expect(h.capture).not.toHaveBeenCalled();
    expect(await readFile(mkv, 'utf8')).toBe('ORIGINAL');
    expect(await exists(sidecar)).toBe(true);
  });

  it('treats mkvmerge exit 1 (warnings) with an output as success', async () => {
    h.capture.mockImplementation(async () => {
      await writeFile(part, 'EMBEDDED');
      return { code: 1, stdoutBytes: 0, stderr: 'warning' };
    });

    await handleSubtitleEmbed(job);

    expect(h.completed).toHaveBeenCalledWith(7, null);
    expect(await readFile(mkv, 'utf8')).toBe('EMBEDDED');
  });

  it('reports remux_failed on exit 2, removes the part and keeps every sidecar', async () => {
    h.capture.mockImplementation(async () => {
      await writeFile(part, 'HALF');
      return { code: 2, stdoutBytes: 0, stderr: 'boom' };
    });

    await handleSubtitleEmbed(job);

    expect(h.failed).toHaveBeenCalledWith(7, 'error.subtitleEmbed.remux_failed');
    expect(h.completed).not.toHaveBeenCalled();
    expect(await exists(part)).toBe(false);
    expect(await exists(sidecar)).toBe(true);
    expect(await readFile(mkv, 'utf8')).toBe('ORIGINAL');
    expect(await Promise.all(h.tempDirs.map(exists))).toEqual([false]);
  });

  it('maps a non-keyed error to remux_failed', async () => {
    h.metadata.mockRejectedValue(new Error('unexpected'));

    await handleSubtitleEmbed(job);

    expect(h.failed).toHaveBeenCalledWith(7, 'error.subtitleEmbed.remux_failed');
  });

  it('reports subtitle_unreadable when a sidecar cannot be read', async () => {
    await rm(sidecar);

    await handleSubtitleEmbed(job);

    expect(h.failed).toHaveBeenCalledWith(7, 'error.subtitleEmbed.subtitle_unreadable');
    expect(h.capture).not.toHaveBeenCalled();
    expect(await Promise.all(h.tempDirs.map(exists))).toEqual([false]);
  });

  it('never renames and keeps the sidecars when verification rejects the result', async () => {
    h.metadata.mockImplementation(async (path: string) => ({
      metadata: path === mkv ? ORIGINAL : { ...RESULT, format: { duration: '103' } },
      raw: '',
    }));

    await handleSubtitleEmbed(job);

    expect(h.failed).toHaveBeenCalledWith(7, 'error.subtitleEmbed.verify_failed');
    expect(h.events.some((e) => e.startsWith('rename:'))).toBe(false);
    expect(await exists(part)).toBe(false);
    expect(await exists(sidecar)).toBe(true);
    expect(await readFile(mkv, 'utf8')).toBe('ORIGINAL');
    expect(await Promise.all(h.tempDirs.map(exists))).toEqual([false]);
  });

  it('renames once after chmod/chown and unlinks the sidecars only afterwards', async () => {
    await handleSubtitleEmbed(job);

    const at = (prefix: string) => h.events.findIndex((e) => e.startsWith(prefix));
    expect(h.events.filter((e) => e.startsWith('rename:'))).toHaveLength(1);
    expect(at('chmod:')).toBeLessThan(at('rename:'));
    expect(at('chown:')).toBeLessThan(at('rename:'));
    expect(at('rename:')).toBeLessThan(at('unlink:'));
    expect(h.completed).toHaveBeenCalledWith(7, null);
    expect(h.failed).not.toHaveBeenCalled();
    expect(await readFile(mkv, 'utf8')).toBe('EMBEDDED');
    expect(await exists(sidecar)).toBe(false);
    expect(await exists(part)).toBe(false);
    expect(await Promise.all(h.tempDirs.map(exists))).toEqual([false]);
  });

  it('completes with sidecar_delete_failed when a sidecar cannot be deleted', async () => {
    await rm(sidecar);
    const target = join(dir, 'elsewhere.srt');
    await writeFile(target, SRT);
    await symlink(target, sidecar);

    await handleSubtitleEmbed(job);

    expect(h.completed).toHaveBeenCalledWith(7, 'error.subtitleEmbed.sidecar_delete_failed');
    expect(h.failed).not.toHaveBeenCalled();
    expect(await readFile(mkv, 'utf8')).toBe('EMBEDDED');
    expect(await exists(target)).toBe(true);
  });

  it('refuses to delete a sidecar outside the film folder but still completes', async () => {
    const other = join(dir, 'sub');
    await mkdir(other);
    const stray = join(other, 'Film.spa.srt');
    await writeFile(stray, SRT);
    h.details.mockResolvedValue({
      id: 7,
      filePath: mkv,
      tracks: [{ sourcePath: stray, languageIso3: 'spa', trackTitle: 'Español', isDefault: false, isForced: false, offsetMs: 0 }],
    });

    await handleSubtitleEmbed(job);

    expect(h.completed).toHaveBeenCalledWith(7, 'error.subtitleEmbed.sidecar_delete_failed');
    expect(await exists(stray)).toBe(true);
  });

  it('reports no warning when a sidecar is already gone by deletion time', async () => {
    h.metadata.mockImplementation(async (path: string) => {
      if (path !== mkv) await rm(sidecar, { force: true });
      return { metadata: path === mkv ? ORIGINAL : RESULT, raw: '' };
    });

    await handleSubtitleEmbed(job);

    expect(h.completed).toHaveBeenCalledWith(7, null);
  });
});
