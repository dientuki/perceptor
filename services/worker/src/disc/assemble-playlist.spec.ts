// Defends against a silent bad remux: a failed or cancelled mkvmerge leaving a half-written
// .perceptor.mkv behind, an exit 2 whose reason (printed on stdout) is lost, or a stale leftover
// from a previous attempt being mistaken for a fresh assembly. Spec 111: a truncated film reused as
// complete because a record outlived the file it described (size or mtime changed, nothing re-checked).

import { mkdtemp, mkdir, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EncodeCancelledError } from '../encode/cancellation';
import { KeyedError } from '../i18n/keyed-error';
import { ERROR_ENCODE_DISC_REMUX_FAILED } from '../i18n/error-keys';

vi.mock('../ffmpeg/capture', () => ({ runFfmpegCapture: vi.fn() }));

import { runFfmpegCapture } from '../ffmpeg/capture';
import { installVerdictStore } from '../encode/verdict-store';
import { assemblePlaylist } from './assemble-playlist';

const capture = vi.mocked(runFfmpegCapture);

let root: string;
let playlist: string;
let expected: string;
let store: Map<string, string>;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'assemble-'));
  await mkdir(join(root, 'BDMV', 'PLAYLIST'), { recursive: true });
  playlist = join(root, 'BDMV', 'PLAYLIST', '00800.mpls');
  await writeFile(playlist, 'x');
  expected = join(root, '00800.perceptor.mkv');
  capture.mockReset();
  store = new Map();
  installVerdictStore({
    get: async (key) => store.get(key) ?? null,
    set: async (key, value) => {
      store.set(key, value);
      return 'OK';
    },
  });
});

afterEach(async () => {
  installVerdictStore(null);
  await rm(root, { recursive: true, force: true });
});

describe('assemblePlaylist', () => {
  it('returns <disc root>/<playlist>.perceptor.mkv on exit 0', async () => {
    capture.mockImplementation(async (args) => {
      await writeFile(args[1], 'mkv');
      return { code: 0, stdoutBytes: 0, stderr: '', stdout: '' };
    });
    const out = await assemblePlaylist(playlist, new AbortController().signal);
    expect(out).toBe(expected);
    expect(capture.mock.calls[0][0]).toEqual(['-o', expected, playlist]);
    expect(capture.mock.calls[0][2]).toEqual({ binary: 'mkvmerge', keepStdout: true });
  });

  it('treats exit 1 (warnings) with the file present as success', async () => {
    capture.mockImplementation(async (args) => {
      await writeFile(args[1], 'mkv');
      return { code: 1, stdoutBytes: 0, stderr: '', stdout: 'Warning: x' };
    });
    await expect(assemblePlaylist(playlist, new AbortController().signal)).resolves.toBe(expected);
    expect(existsSync(expected)).toBe(true);
  });

  it('fails when exit 1 left no file', async () => {
    capture.mockResolvedValue({ code: 1, stdoutBytes: 0, stderr: '', stdout: 'Warning' });
    await expect(assemblePlaylist(playlist, new AbortController().signal)).rejects.toBeInstanceOf(KeyedError);
  });

  it('throws disc_remux_failed on exit 2 with stdout in stderr, and removes the partial', async () => {
    capture.mockImplementation(async (args) => {
      await writeFile(args[1], 'partial');
      return { code: 2, stdoutBytes: 20, stderr: '', stdout: 'Error: could not read clip 00001.m2ts' };
    });
    const err = await assemblePlaylist(playlist, new AbortController().signal).catch((e) => e);
    expect(err).toBeInstanceOf(KeyedError);
    expect(err.key).toBe(ERROR_ENCODE_DISC_REMUX_FAILED);
    expect(err.params.code).toBe(2);
    expect(err.params.stderr).toContain('could not read clip 00001.m2ts');
    expect(existsSync(expected)).toBe(false);
  });

  it('keeps a non-empty stderr param even when mkvmerge printed nothing', async () => {
    capture.mockResolvedValue({ code: 2, stdoutBytes: 0, stderr: '', stdout: '' });
    const err = await assemblePlaylist(playlist, new AbortController().signal).catch((e) => e);
    expect(err.params.stderr.length).toBeGreaterThan(0);
  });

  it('keeps only the tail of a very long output', async () => {
    capture.mockResolvedValue({ code: 2, stdoutBytes: 0, stderr: '', stdout: 'a'.repeat(5000) + 'END' });
    const err = await assemblePlaylist(playlist, new AbortController().signal).catch((e) => e);
    expect(err.params.stderr.length).toBeLessThanOrEqual(2000);
    expect(err.params.stderr.endsWith('END')).toBe(true);
  });

  it('rethrows EncodeCancelledError untouched and removes the partial', async () => {
    const cancelled = new EncodeCancelledError();
    capture.mockImplementation(async (args) => {
      await writeFile(args[1], 'partial');
      throw cancelled;
    });
    await expect(assemblePlaylist(playlist, new AbortController().signal)).rejects.toBe(cancelled);
    expect(existsSync(expected)).toBe(false);
  });

  it('wraps a spawn error as disc_remux_failed', async () => {
    capture.mockRejectedValue(new Error('spawn mkvmerge ENOENT'));
    const err = await assemblePlaylist(playlist, new AbortController().signal).catch((e) => e);
    expect(err.key).toBe(ERROR_ENCODE_DISC_REMUX_FAILED);
    expect(err.params.stderr).toContain('ENOENT');
  });

  it('removes a leftover before the run', async () => {
    await writeFile(expected, 'stale');
    let leftoverSeen = true;
    capture.mockImplementation(async (args) => {
      leftoverSeen = existsSync(args[1]);
      return { code: 2, stdoutBytes: 0, stderr: '', stdout: 'boom' };
    });
    await assemblePlaylist(playlist, new AbortController().signal).catch(() => undefined);
    expect(leftoverSeen).toBe(false);
    expect((await readdir(root)).filter((f) => f.endsWith('.perceptor.mkv'))).toEqual([]);
  });

  describe('assembly record (spec 111)', () => {
    const run = () => assemblePlaylist(playlist, new AbortController().signal);
    const okMkv = (content: string) =>
      capture.mockImplementation(async (args) => {
        await writeFile(args[1], content);
        return { code: 0, stdoutBytes: 0, stderr: '', stdout: '' };
      });

    it('assembles when no record exists, then records the output', async () => {
      okMkv('mkv');
      await run();
      expect(capture).toHaveBeenCalledTimes(1);
      expect(store.size).toBe(1);
    });

    it('does not spawn mkvmerge when size and mtime match the record', async () => {
      okMkv('mkv');
      await run();
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      await expect(run()).resolves.toBe(expected);
      expect(capture).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith(`[disc] reused ${expected}`);
      log.mockRestore();
    });

    it('reassembles when the output size differs from the record', async () => {
      okMkv('mkv');
      await run();
      await writeFile(expected, 'truncated-or-longer');
      await run();
      expect(capture).toHaveBeenCalledTimes(2);
    });

    it('reassembles when the output mtime differs from the record', async () => {
      okMkv('mkv');
      await run();
      await utimes(expected, new Date(1_000_000), new Date(1_000_000));
      await run();
      expect(capture).toHaveBeenCalledTimes(2);
    });

    it('records nothing after a failed mkvmerge', async () => {
      capture.mockResolvedValue({ code: 2, stdoutBytes: 0, stderr: '', stdout: 'boom' });
      await run().catch(() => undefined);
      expect(store.size).toBe(0);
    });

    it('records nothing after a cancelled mkvmerge', async () => {
      capture.mockRejectedValue(new EncodeCancelledError());
      await run().catch(() => undefined);
      expect(store.size).toBe(0);
    });

    it('assembles as today and records nothing when the playlist cannot be identified', async () => {
      await rm(playlist);
      okMkv('mkv');
      await run();
      expect(capture).toHaveBeenCalledTimes(1);
      expect(store.size).toBe(0);
    });
  });
});
