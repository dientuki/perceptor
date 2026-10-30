// Subtitle content pruning fails silently in both directions: reading the wrong
// tracks (indices that differ from the ones the command later maps) drops a
// good track or keeps clutter, and a read failure that throws instead of
// keeping everything would fail an encode over a luxury. The resolver is tested
// with the FFmpeg spawn mocked: no spawn and no log when no language has a
// choice, the sample limit as an output option (never before -i, where it would
// not bound the extracted track), failures degrade to "keep everything" and are
// never cached, a cancellation propagates, and the candidate indices it reads
// equal the ones getSubtitleParams maps for the same input.

import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EncodeCancelledError } from './cancellation';
import { buildSubtitleSampleArgs, resolveSubtitlePruning } from './subtitle-prune';
import { installVerdictStore, type VerdictRedis } from './verdict-store';
import { runFfmpegCapture } from '../ffmpeg/capture';
import { getSubtitleParams } from '../ffmpeg/params';

vi.mock('../ffmpeg/capture', () => ({ runFfmpegCapture: vi.fn() }));

const mockCapture = vi.mocked(runFfmpegCapture);
const signal = new AbortController().signal;

function sub(index: number, language: string, extra: Record<string, unknown> = {}) {
  return {
    index,
    codec_type: 'subtitle',
    codec_name: 'subrip',
    tags: { language, NUMBER_OF_FRAMES: '500', NUMBER_OF_BYTES: '20000' },
    disposition: {},
    ...extra,
  };
}

const details = {
  allowedSubtitleFormats: ['srt', 'ass', 'webvtt', 'mov_text', 'pgs'] as any,
  allowedSubtitleLanguagesIso3: ['eng', 'spa', 'fra'],
  allowedSubtitleLanguageTags: ['en', 'es-419', 'fr'],
};

function srt(lines: string[]): string {
  return lines
    .map((text, i) => `${i + 1}\n00:00:${String(i * 4).padStart(2, '0')},000 --> 00:00:${String(i * 4 + 2).padStart(2, '0')},000\n${text}\n`)
    .join('\n');
}

const SAME = srt(['one', 'two', 'three']);
const SDH = srt(['[door]', '[wind]', 'three']);

class FakeRedis implements VerdictRedis {
  readonly entries = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.entries.get(key) ?? null;
  }
  async set(key: string, value: string): Promise<unknown> {
    this.entries.set(key, value);
    return 'OK';
  }
}

let dir = '';
let file = '';
let redis: FakeRedis;

beforeEach(() => {
  mockCapture.mockReset();
  redis = new FakeRedis();
  installVerdictStore(redis);
  dir = mkdtempSync(join(tmpdir(), 'subprune-'));
  file = join(dir, 'in.mkv');
  writeFileSync(file, 'x');
});

afterEach(() => {
  installVerdictStore(null);
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('buildSubtitleSampleArgs', () => {
  it('puts -t 900 after each -map and never before -i', () => {
    const args = buildSubtitleSampleArgs('/in.mkv', [3, 5]);
    expect(args.slice(0, 5)).toEqual(['-v', 'error', '-nostdin', '-i', '/in.mkv']);
    expect(args.indexOf('-t')).toBeGreaterThan(args.indexOf('-i'));
    expect(args.slice(5)).toEqual([
      '-map', '0:3', '-t', '900', '-c:s', 'srt', '-f', 'srt', 'pipe:3',
      '-map', '0:5', '-t', '900', '-c:s', 'srt', '-f', 'srt', 'pipe:4',
    ]);
  });
});

describe('resolveSubtitlePruning', () => {
  it('does not spawn or log when no language has more than one text track', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const metadata = { streams: [sub(2, 'eng'), sub(3, 'spa'), sub(4, 'fra', { codec_name: 'hdmv_pgs_subtitle' })] };
    const drops = await resolveSubtitlePruning(details, file, metadata, signal);
    expect(drops.size).toBe(0);
    expect(mockCapture).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('returns an empty set plus one failure line when ffmpeg exits non-zero', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockCapture.mockResolvedValue({ code: 1, stdoutBytes: 0, stderr: '' });
    const metadata = { streams: [sub(2, 'eng'), sub(3, 'eng')] };
    const drops = await resolveSubtitlePruning(details, file, metadata, signal);
    expect(drops.size).toBe(0);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toMatch(/^\[subs\] read failed: /);
  });

  it('returns an empty set plus one failure line when the spawn rejects', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockCapture.mockRejectedValue(new Error('spawn ENOENT'));
    const metadata = { streams: [sub(2, 'eng'), sub(3, 'eng')] };
    const drops = await resolveSubtitlePruning(details, file, metadata, signal);
    expect(drops.size).toBe(0);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain('spawn ENOENT');
  });

  it('propagates a cancellation', async () => {
    mockCapture.mockRejectedValue(new EncodeCancelledError());
    const metadata = { streams: [sub(2, 'eng'), sub(3, 'eng')] };
    await expect(resolveSubtitlePruning(details, file, metadata, signal)).rejects.toBeInstanceOf(
      EncodeCancelledError,
    );
  });

  it('does not cache a failure', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    mockCapture.mockResolvedValueOnce({ code: 1, stdoutBytes: 0, stderr: '' });
    mockCapture.mockResolvedValueOnce({ code: 0, stdoutBytes: 0, stderr: '', outputs: [SAME, SDH] });
    const metadata = { streams: [sub(2, 'eng'), sub(3, 'eng')] };
    expect((await resolveSubtitlePruning(details, file, metadata, signal)).size).toBe(0);
    expect([...(await resolveSubtitlePruning(details, file, metadata, signal))]).toEqual([3]);
    expect(mockCapture).toHaveBeenCalledTimes(2);
  });

  it('logs one line per group on success and reuses the verdict without spawning again', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockCapture.mockResolvedValue({ code: 0, stdoutBytes: 0, stderr: '', outputs: [SAME, SDH, SAME, SAME] });
    const metadata = {
      streams: [sub(2, 'eng'), sub(3, 'eng'), sub(4, 'spa'), sub(5, 'spa')],
    };
    const first = await resolveSubtitlePruning(details, file, metadata, signal);
    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(mockCapture.mock.calls[0][2]).toEqual({ extraOutputs: 4 });
    expect([...first].sort()).toEqual([3, 5]);
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0][0]).toBe('[subs] eng 2:3:0.0%=keep 3:3:66.7%=drop (sdh)');
    expect(log.mock.calls[1][0]).toBe('[subs] spa 4:3:0.0%=keep 5:3:0.0%=drop (same as 4)');

    const second = await resolveSubtitlePruning(details, file, metadata, signal);
    expect(second).toEqual(first);
    expect(mockCapture).toHaveBeenCalledTimes(1);
  });

  // Spec 111, REQ-1 REQ-4
  it('reuses a stored verdict as a Set with a reused log line', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockCapture.mockResolvedValue({ code: 0, stdoutBytes: 0, stderr: '', outputs: [SAME, SDH] });
    const metadata = { streams: [sub(2, 'eng'), sub(3, 'eng')] };
    await resolveSubtitlePruning(details, file, metadata, signal);
    log.mockClear();
    const again = await resolveSubtitlePruning(details, file, metadata, signal);
    expect(again).toBeInstanceOf(Set);
    expect([...again]).toEqual([3]);
    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('[subs] reused drops=[3]');
    expect([...redis.entries.values()]).toEqual(['[3]']);
  });

  // Spec 111, REQ-4
  it('misses when the set of qualifying streams changes', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    mockCapture.mockResolvedValue({ code: 0, stdoutBytes: 0, stderr: '', outputs: [SAME, SDH, SAME] });
    await resolveSubtitlePruning(details, file, { streams: [sub(2, 'eng'), sub(3, 'eng')] }, signal);
    await resolveSubtitlePruning(details, file, { streams: [sub(2, 'eng'), sub(3, 'eng'), sub(4, 'eng')] }, signal);
    expect(mockCapture).toHaveBeenCalledTimes(2);
  });

  // Spec 111, REQ-3
  it('misses when the file size or mtime changes', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    mockCapture.mockResolvedValue({ code: 0, stdoutBytes: 0, stderr: '', outputs: [SAME, SDH] });
    const metadata = { streams: [sub(2, 'eng'), sub(3, 'eng')] };
    await resolveSubtitlePruning(details, file, metadata, signal);
    utimesSync(file, new Date(1_000_000), new Date(1_000_000));
    await resolveSubtitlePruning(details, file, metadata, signal);
    expect(mockCapture).toHaveBeenCalledTimes(2);
    writeFileSync(file, 'longer content');
    await resolveSubtitlePruning(details, file, metadata, signal);
    expect(mockCapture).toHaveBeenCalledTimes(3);
  });

  // Spec 111, REQ-1
  it('stores nothing on cancellation or failure', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const metadata = { streams: [sub(2, 'eng'), sub(3, 'eng')] };
    mockCapture.mockRejectedValueOnce(new EncodeCancelledError());
    await expect(resolveSubtitlePruning(details, file, metadata, signal)).rejects.toBeInstanceOf(EncodeCancelledError);
    mockCapture.mockResolvedValueOnce({ code: 1, stdoutBytes: 0, stderr: '' });
    await resolveSubtitlePruning(details, file, metadata, signal);
    expect(redis.entries.size).toBe(0);
  });

  it('reads exactly the indices getSubtitleParams maps for a multi-language, multi-variant input', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const metadata = {
      streams: [
        sub(2, 'eng'),
        sub(3, 'eng', { disposition: { hearing_impaired: 1 } }),
        sub(4, 'eng'),
        sub(5, 'spa', { tags: { language: 'spa', title: 'Latinoamericano', NUMBER_OF_FRAMES: '500' } }),
        sub(6, 'spa', { tags: { language: 'spa', title: 'Castellano', NUMBER_OF_FRAMES: '500' } }),
        sub(7, 'spa', { tags: { language: 'spa', title: 'Latino forced', NUMBER_OF_FRAMES: '500' } }),
        sub(8, 'fra'),
        sub(9, 'eng', { codec_name: 'hdmv_pgs_subtitle' }),
      ],
    };
    mockCapture.mockImplementation(async (args: string[]) => {
      const n = args.filter((a) => a === '-map').length;
      return { code: 0, stdoutBytes: 0, stderr: '', outputs: Array(n).fill(SAME) };
    });
    await resolveSubtitlePruning(details, file, metadata, signal);

    const args = mockCapture.mock.calls[0][0];
    const read = args.flatMap((a, i) => (a === '-map' ? [Number(args[i + 1].split(':')[1])] : []));

    const mapped = getSubtitleParams(
      metadata.streams,
      details.allowedSubtitleFormats,
      details.allowedSubtitleLanguagesIso3,
      details.allowedSubtitleLanguageTags,
      {},
      new Set(),
    )
      .flatMap((a, i, all) => (all[i - 1] === '-map' ? [Number(a.split(':')[1])] : []));

    const lang = (i: number) => metadata.streams.find((s) => s.index === i)!.tags.language;
    const expected = mapped.filter(
      (i) =>
        metadata.streams.find((s) => s.index === i)!.codec_name !== 'hdmv_pgs_subtitle' &&
        mapped.filter((j) => lang(j) === lang(i)).length > 1,
    );
    expect(expected.length).toBeGreaterThan(1);
    expect([...read].sort((a, b) => a - b)).toEqual([...expected].sort((a, b) => a - b));
  });
});
