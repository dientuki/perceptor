// Dub-card tail trim fails silently in both directions: a misclassified tail
// either removes real content from the end of an episode or leaves minutes of
// static dubbing cards in the library, and in neither case does any error
// surface. The classifier counts the consecutive card-length segments at the
// end of the freeze run (setting aside a final segment truncated by the end of
// the file) and requires at least five of them, at least three exactly one
// card long. It is tested against real recorded freezedetect output
// (fixtures/dub-trim/): tails that open with a non-card segment, tails with a
// truncated last card, merged-card tails, and the files that must be kept
// whole, plus synthetic runs for each edge of the rule. The resolver is tested
// with the FFmpeg spawn mocked: it must never throw on a failed detection,
// never cache a failure, and never swallow a cancellation.

import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EncodeCancelledError } from './cancellation';
import {
  classifyTail,
  isDubTail,
  parseFreezes,
  resolveDubTrim,
  videoEndSeconds,
} from './dub-trim';
import { runFfmpegCapture } from '../ffmpeg/capture';
import { installVerdictStore } from './verdict-store';

vi.mock('../ffmpeg/capture', () => ({ runFfmpegCapture: vi.fn() }));

const mockCapture = vi.mocked(runFfmpegCapture);

function fixture(name: string): string {
  return readFileSync(join(__dirname, '../../fixtures/dub-trim', `${name}.freezes.txt`), 'utf8');
}

function classify(name: string) {
  return classifyTail(parseFreezes(fixture(name), 300), 300);
}

describe('classifyTail on recorded freezedetect output', () => {
  it.each([
    ['neagley-s01e01', 173.822, 60, 60, 58],
    ['voltron-s03e01', 273.862, 13, 11, 11],
    ['war-machine', 140.905, 52, 51, 35],
    ['wrecking-crew', 168.909, 65, 64, 63],
    ['rtte-s01e01', 284.442, 8, 6, 6],
    ['diabolical-s01e01', 243.943, 22, 22, 18],
  ])('cuts %s at the start of the whole run', (name, runStart, cards, multiples, exact) => {
    const result = classify(name);
    expect(result.runStart).toBeCloseTo(runStart, 3);
    expect(result.cards).toBe(cards);
    expect(result.multiples).toBe(multiples);
    expect(result.exact).toBe(exact);
    expect(isDubTail(result)).toBe(true);
  });

  it('keeps chernobyl-s01e01: card-style credits whose last segment is not a card multiple', () => {
    const result = classify('chernobyl-s01e01');
    expect(result.cards).toBe(56);
    expect(result.multiples).toBe(0);
    expect(isDubTail(result)).toBe(false);
  });

  it('keeps reacher-s01e01: a single trailing freeze is under five cards', () => {
    const result = classify('reacher-s01e01');
    expect(result.cards).toBe(1);
    expect(isDubTail(result)).toBe(false);
  });

  it('keeps foundation-s01e01: no freeze reaches the end of the window', () => {
    const result = classify('foundation-s01e01');
    expect(result.runStart).toBeNull();
    expect(isDubTail(result)).toBe(false);
  });

  it('keeps haven-s01e01: only four trailing cards', () => {
    const result = classify('haven-s01e01');
    expect(result.multiples).toBe(4);
    expect(isDubTail(result)).toBe(false);
  });

  it('keeps arrival: five trailing multiples but none exactly one card', () => {
    const result = classify('arrival');
    expect(result.multiples).toBe(5);
    expect(result.exact).toBe(0);
    expect(isDubTail(result)).toBe(false);
  });

  it('keeps dawn-of-the-dragon-racers: only two trailing cards in a longer run', () => {
    const result = classify('dawn-of-the-dragon-racers');
    expect(result.cards).toBe(13);
    expect(result.multiples).toBe(2);
    expect(isDubTail(result)).toBe(false);
  });
});

describe('classifyTail rule edges on synthetic runs', () => {
  const UNIT = 2.002;

  function run(durations: number[]) {
    let t = 10;
    const freezes = durations.map((d) => {
      const f = { start: t, end: t + d };
      t = f.end + 0.05;
      return f;
    });
    return classifyTail(freezes, freezes[freezes.length - 1].end);
  }

  it('sets aside a truncated last segment before counting', () => {
    const result = run([UNIT, UNIT, UNIT, UNIT, UNIT, 1.3]);
    expect(result.cards).toBe(6);
    expect(result.multiples).toBe(5);
    expect(isDubTail(result)).toBe(true);
  });

  it('does not set aside a last segment shorter than half a second', () => {
    const result = run([UNIT, UNIT, UNIT, UNIT, UNIT, 0.3]);
    expect(result.multiples).toBe(0);
    expect(isDubTail(result)).toBe(false);
  });

  it('sets aside at most one segment', () => {
    const result = run([UNIT, UNIT, UNIT, UNIT, UNIT, 1.3, 1.3]);
    expect(result.multiples).toBe(0);
    expect(isDubTail(result)).toBe(false);
  });

  it('keeps four trailing cards', () => {
    expect(isDubTail(run([UNIT, UNIT, UNIT, UNIT]))).toBe(false);
  });

  it('cuts five trailing cards', () => {
    expect(isDubTail(run([UNIT, UNIT, UNIT, UNIT, UNIT]))).toBe(true);
  });

  it('stops counting at the first non-multiple walking backwards', () => {
    const result = run([UNIT, UNIT, UNIT, 3.1, UNIT, UNIT, UNIT, UNIT]);
    expect(result.multiples).toBe(4);
    expect(isDubTail(result)).toBe(false);
  });

  it('keeps five trailing cards of two units each with none exactly one', () => {
    const result = run([2 * UNIT, 2 * UNIT, 2 * UNIT, 2 * UNIT, 2 * UNIT]);
    expect(result.multiples).toBe(5);
    expect(result.exact).toBe(0);
    expect(isDubTail(result)).toBe(false);
  });

  it('counts merged cards among single cards', () => {
    const result = run([UNIT, 2 * UNIT, UNIT, 2 * UNIT, UNIT, 2 * UNIT]);
    expect(result.multiples).toBe(6);
    expect(result.exact).toBe(3);
    expect(isDubTail(result)).toBe(true);
  });

  it('cuts at the start of the whole run, not of the trailing cards', () => {
    const result = run([5.5, UNIT, UNIT, UNIT, UNIT, UNIT]);
    expect(result.runStart).toBe(10);
    expect(result.multiples).toBe(5);
    expect(isDubTail(result)).toBe(true);
  });
});

describe('videoEndSeconds', () => {
  it('prefers the video stream duration', () => {
    const metadata = {
      streams: [{ codec_type: 'video', duration: '100.5' }],
      format: { duration: '200' },
    };
    expect(videoEndSeconds(metadata)).toBe(100.5);
  });

  it('uses the DURATION tag when the stream duration is N/A', () => {
    const metadata = {
      streams: [{ codec_type: 'video', duration: 'N/A', tags: { DURATION: '00:57:22.356000000' } }],
      format: { duration: '3442.408' },
    };
    expect(videoEndSeconds(metadata)).toBeCloseTo(3442.356, 3);
  });

  it('trusts a tag shorter than the container duration', () => {
    const metadata = {
      streams: [{ codec_type: 'video', duration: 'N/A', tags: { DURATION: '01:08:21.100000000' } }],
      format: { duration: '4121.768' },
    };
    expect(videoEndSeconds(metadata)).toBeCloseTo(4101.1, 3);
  });

  it('falls back to the container duration when the stream reports neither', () => {
    const metadata = { streams: [{ codec_type: 'video' }], format: { duration: '4121.768' } };
    expect(videoEndSeconds(metadata)).toBeCloseTo(4121.768, 3);
  });

  it('is NaN when nothing is readable', () => {
    expect(videoEndSeconds({ streams: [], format: {} })).toBeNaN();
  });
});

describe('resolveDubTrim', () => {
  const signal = new AbortController().signal;
  const metadata = { streams: [{ codec_type: 'video', duration: '1000' }], format: {} };
  const on = { dubTrimEnabled: true };

  let dir: string;
  let a: string;
  let b: string;
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map();
    installVerdictStore({
      get: async (key) => store.get(key) ?? null,
      set: async (key, value) => {
        store.set(key, value);
        return 'OK';
      },
    });
    dir = mkdtempSync(join(tmpdir(), 'dubtrim-'));
    a = join(dir, 'a.mkv');
    b = join(dir, 'b.mkv');
    writeFileSync(a, 'aaaa');
    writeFileSync(b, 'bbbbbb');
    mockCapture.mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    installVerdictStore(null);
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function ok(name: string) {
    return { code: 0, stdoutBytes: 0, stderr: fixture(name) };
  }

  it('does nothing and spawns nothing when the switch is off', async () => {
    expect(await resolveDubTrim({ dubTrimEnabled: false }, a, metadata, signal)).toBeNull();
    expect(mockCapture).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
  });

  it('returns the absolute cut and logs exactly one line', async () => {
    mockCapture.mockResolvedValueOnce(ok('neagley-s01e01'));
    const cut = await resolveDubTrim(on, a, metadata, signal);
    expect(cut).toBeCloseTo(700 + 173.822, 3);
    expect(console.log).toHaveBeenCalledTimes(1);
    expect(vi.mocked(console.log).mock.calls[0][0]).toContain(`[dubtrim] input=${a} cards=60 multiples=60 -> cut=873.822`);
    const args = mockCapture.mock.calls[0][0];
    expect(args).toContain('-vf');
    expect(args).not.toContain('-v');
    expect(args).not.toContain('-loglevel');
  });

  it('returns null and logs keep for a file with no dub tail', async () => {
    mockCapture.mockResolvedValueOnce(ok('foundation-s01e01'));
    expect(await resolveDubTrim(on, a, metadata, signal)).toBeNull();
    expect(vi.mocked(console.log).mock.calls[0][0]).toContain('-> keep');
  });

  it('analyses each input path separately', async () => {
    mockCapture.mockResolvedValueOnce(ok('neagley-s01e01')).mockResolvedValueOnce(ok('war-machine'));
    const cutA = await resolveDubTrim(on, a, metadata, signal);
    const cutB = await resolveDubTrim(on, b, metadata, signal);
    expect(mockCapture).toHaveBeenCalledTimes(2);
    expect(cutA).toBeCloseTo(873.822, 3);
    expect(cutB).toBeCloseTo(840.905, 3);
  });

  it('reuses the verdict for the same input', async () => {
    mockCapture.mockResolvedValueOnce(ok('neagley-s01e01'));
    const first = await resolveDubTrim(on, a, metadata, signal);
    const second = await resolveDubTrim(on, a, metadata, signal);
    expect(second).toBe(first);
    expect(mockCapture).toHaveBeenCalledTimes(1);
  });

  it('hit skips freezedetect and logs reused', async () => {
    mockCapture.mockResolvedValueOnce(ok('neagley-s01e01'));
    const first = await resolveDubTrim(on, a, metadata, signal);
    const second = await resolveDubTrim(on, a, metadata, signal);
    expect(second).toBe(first);
    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(vi.mocked(console.log).mock.calls[1][0]).toContain('(reused)');
  });

  it('misses when the size changes', async () => {
    mockCapture.mockResolvedValue(ok('neagley-s01e01'));
    await resolveDubTrim(on, a, metadata, signal);
    writeFileSync(a, 'aaaaaaaa');
    await resolveDubTrim(on, a, metadata, signal);
    expect(mockCapture).toHaveBeenCalledTimes(2);
  });

  it('misses when the mtime changes', async () => {
    mockCapture.mockResolvedValue(ok('neagley-s01e01'));
    await resolveDubTrim(on, a, metadata, signal);
    utimesSync(a, new Date(1_000_000), new Date(1_000_000));
    await resolveDubTrim(on, a, metadata, signal);
    expect(mockCapture).toHaveBeenCalledTimes(2);
  });

  it('stores nothing on failure or cancellation', async () => {
    mockCapture.mockResolvedValueOnce({ code: 1, stdoutBytes: 0, stderr: '' });
    await resolveDubTrim(on, a, metadata, signal);
    mockCapture.mockRejectedValueOnce(new EncodeCancelledError());
    await expect(resolveDubTrim(on, a, metadata, signal)).rejects.toBeInstanceOf(EncodeCancelledError);
    expect(store.size).toBe(0);
  });

  it('returns null silently on a non-zero exit and does not cache the failure', async () => {
    mockCapture
      .mockResolvedValueOnce({ code: 1, stdoutBytes: 0, stderr: '' })
      .mockResolvedValueOnce(ok('neagley-s01e01'));
    expect(await resolveDubTrim(on, a, metadata, signal)).toBeNull();
    expect(console.log).not.toHaveBeenCalled();
    expect(await resolveDubTrim(on, a, metadata, signal)).toBeCloseTo(873.822, 3);
    expect(mockCapture).toHaveBeenCalledTimes(2);
  });

  it('returns null silently when no duration is readable', async () => {
    expect(await resolveDubTrim(on, a, { streams: [], format: {} }, signal)).toBeNull();
    expect(mockCapture).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
  });

  it('treats a cut at or below zero as keep', async () => {
    const short = { streams: [{ codec_type: 'video', duration: '100' }], format: {} };
    mockCapture.mockResolvedValueOnce({
      code: 0,
      stdoutBytes: 0,
      stderr:
        Array.from({ length: 5 }, (_, i) => `freeze_start: ${i * 2.002}\nfreeze_end: ${(i + 1) * 2.002}`).join('\n') +
        `\nfreeze_start: ${5 * 2.002}`,
    });
    expect(await resolveDubTrim(on, a, short, signal)).toBeNull();
    expect(vi.mocked(console.log).mock.calls[0][0]).toContain('-> keep');
  });

  it('rethrows a cancellation', async () => {
    mockCapture.mockRejectedValueOnce(new EncodeCancelledError());
    await expect(resolveDubTrim(on, a, metadata, signal)).rejects.toBeInstanceOf(EncodeCancelledError);
  });
});
