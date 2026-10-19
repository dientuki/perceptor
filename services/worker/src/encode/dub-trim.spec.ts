// Dub-card tail trim fails silently in both directions: a misclassified tail
// either removes real content from the end of an episode or leaves minutes of
// static dubbing cards in the library, and in neither case does any error
// surface. The classifier is tested against real recorded freezedetect output
// (fixtures/dub-trim/), including the three tails whose run opens with a
// non-2-second segment and the three files that must be kept whole. The
// resolver is tested with the FFmpeg spawn mocked: it must never throw on a
// failed detection, never cache a failure, and never swallow a cancellation.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EncodeCancelledError } from './cancellation';
import {
  classifyTail,
  isDubTail,
  parseFreezes,
  resetDubTrimCache,
  resolveDubTrim,
  videoEndSeconds,
} from './dub-trim';
import { runFfmpegCapture } from '../ffmpeg/capture';

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
    ['neagley-s01e01', 173.822, 60, 60],
    ['voltron-s03e01', 273.862, 13, 11],
    ['war-machine', 140.905, 52, 51],
    ['wrecking-crew', 168.909, 65, 64],
  ])('cuts %s at the start of the whole run', (name, runStart, cards, multiples) => {
    const result = classify(name);
    expect(result.runStart).toBeCloseTo(runStart, 3);
    expect(result.cards).toBe(cards);
    expect(result.multiples).toBe(multiples);
    expect(isDubTail(result)).toBe(true);
  });

  it('keeps chernobyl-s01e01: a long run of card-style credits fails the 80% rule', () => {
    const result = classify('chernobyl-s01e01');
    expect(result.cards).toBe(56);
    expect(result.multiples).toBe(3);
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

  beforeEach(() => {
    resetDubTrimCache();
    mockCapture.mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function ok(name: string) {
    return { code: 0, stdoutBytes: 0, stderr: fixture(name) };
  }

  it('does nothing and spawns nothing when the switch is off', async () => {
    expect(await resolveDubTrim({ dubTrimEnabled: false }, '/a.mkv', metadata, signal)).toBeNull();
    expect(mockCapture).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
  });

  it('returns the absolute cut and logs exactly one line', async () => {
    mockCapture.mockResolvedValueOnce(ok('neagley-s01e01'));
    const cut = await resolveDubTrim(on, '/a.mkv', metadata, signal);
    expect(cut).toBeCloseTo(700 + 173.822, 3);
    expect(console.log).toHaveBeenCalledTimes(1);
    expect(vi.mocked(console.log).mock.calls[0][0]).toContain('[dubtrim] input=/a.mkv cards=60 multiples=60 -> cut=873.822');
    const args = mockCapture.mock.calls[0][0];
    expect(args).toContain('-vf');
    expect(args).not.toContain('-v');
    expect(args).not.toContain('-loglevel');
  });

  it('returns null and logs keep for a file with no dub tail', async () => {
    mockCapture.mockResolvedValueOnce(ok('foundation-s01e01'));
    expect(await resolveDubTrim(on, '/a.mkv', metadata, signal)).toBeNull();
    expect(vi.mocked(console.log).mock.calls[0][0]).toContain('-> keep');
  });

  it('analyses each input path separately', async () => {
    mockCapture.mockResolvedValueOnce(ok('neagley-s01e01')).mockResolvedValueOnce(ok('war-machine'));
    const a = await resolveDubTrim(on, '/a.mkv', metadata, signal);
    const b = await resolveDubTrim(on, '/b.mkv', metadata, signal);
    expect(mockCapture).toHaveBeenCalledTimes(2);
    expect(a).toBeCloseTo(873.822, 3);
    expect(b).toBeCloseTo(840.905, 3);
  });

  it('reuses the verdict for the same input', async () => {
    mockCapture.mockResolvedValueOnce(ok('neagley-s01e01'));
    const first = await resolveDubTrim(on, '/a.mkv', metadata, signal);
    const second = await resolveDubTrim(on, '/a.mkv', metadata, signal);
    expect(second).toBe(first);
    expect(mockCapture).toHaveBeenCalledTimes(1);
  });

  it('returns null silently on a non-zero exit and does not cache the failure', async () => {
    mockCapture
      .mockResolvedValueOnce({ code: 1, stdoutBytes: 0, stderr: '' })
      .mockResolvedValueOnce(ok('neagley-s01e01'));
    expect(await resolveDubTrim(on, '/a.mkv', metadata, signal)).toBeNull();
    expect(console.log).not.toHaveBeenCalled();
    expect(await resolveDubTrim(on, '/a.mkv', metadata, signal)).toBeCloseTo(873.822, 3);
    expect(mockCapture).toHaveBeenCalledTimes(2);
  });

  it('returns null silently when no duration is readable', async () => {
    expect(await resolveDubTrim(on, '/a.mkv', { streams: [], format: {} }, signal)).toBeNull();
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
    expect(await resolveDubTrim(on, '/a.mkv', short, signal)).toBeNull();
    expect(vi.mocked(console.log).mock.calls[0][0]).toContain('-> keep');
  });

  it('rethrows a cancellation', async () => {
    mockCapture.mockRejectedValueOnce(new EncodeCancelledError());
    await expect(resolveDubTrim(on, '/a.mkv', metadata, signal)).rejects.toBeInstanceOf(EncodeCancelledError);
  });
});
