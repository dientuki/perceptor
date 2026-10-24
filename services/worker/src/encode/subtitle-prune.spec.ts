// Subtitle content pruning fails silently in both directions: reading the wrong
// tracks (indices that differ from the ones the command later maps) drops a
// good track or keeps clutter, and a read failure that throws instead of
// keeping everything would fail an encode over a luxury. The resolver is tested
// with the FFmpeg spawn mocked: no spawn and no log when no language has a
// choice, the sample limit as an output option (never before -i, where it would
// not bound the extracted track), failures degrade to "keep everything" and are
// never cached, a cancellation propagates, and the candidate indices it reads
// equal the ones getSubtitleParams maps for the same input.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EncodeCancelledError } from './cancellation';
import { buildSubtitleSampleArgs, resetSubtitlePruneCache, resolveSubtitlePruning } from './subtitle-prune';
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

beforeEach(() => {
  resetSubtitlePruneCache();
  mockCapture.mockReset();
});

afterEach(() => {
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
    const drops = await resolveSubtitlePruning(details, '/in.mkv', metadata, signal);
    expect(drops.size).toBe(0);
    expect(mockCapture).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('returns an empty set plus one failure line when ffmpeg exits non-zero', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockCapture.mockResolvedValue({ code: 1, stdoutBytes: 0, stderr: '' });
    const metadata = { streams: [sub(2, 'eng'), sub(3, 'eng')] };
    const drops = await resolveSubtitlePruning(details, '/in.mkv', metadata, signal);
    expect(drops.size).toBe(0);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toMatch(/^\[subs\] read failed: /);
  });

  it('returns an empty set plus one failure line when the spawn rejects', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockCapture.mockRejectedValue(new Error('spawn ENOENT'));
    const metadata = { streams: [sub(2, 'eng'), sub(3, 'eng')] };
    const drops = await resolveSubtitlePruning(details, '/in.mkv', metadata, signal);
    expect(drops.size).toBe(0);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain('spawn ENOENT');
  });

  it('propagates a cancellation', async () => {
    mockCapture.mockRejectedValue(new EncodeCancelledError());
    const metadata = { streams: [sub(2, 'eng'), sub(3, 'eng')] };
    await expect(resolveSubtitlePruning(details, '/in.mkv', metadata, signal)).rejects.toBeInstanceOf(
      EncodeCancelledError,
    );
  });

  it('does not cache a failure', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    mockCapture.mockResolvedValueOnce({ code: 1, stdoutBytes: 0, stderr: '' });
    mockCapture.mockResolvedValueOnce({ code: 0, stdoutBytes: 0, stderr: '', outputs: [SAME, SDH] });
    const metadata = { streams: [sub(2, 'eng'), sub(3, 'eng')] };
    expect((await resolveSubtitlePruning(details, '/in.mkv', metadata, signal)).size).toBe(0);
    expect([...(await resolveSubtitlePruning(details, '/in.mkv', metadata, signal))]).toEqual([3]);
    expect(mockCapture).toHaveBeenCalledTimes(2);
  });

  it('logs one line per group on success and reuses the verdict without spawning again', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockCapture.mockResolvedValue({ code: 0, stdoutBytes: 0, stderr: '', outputs: [SAME, SDH, SAME, SAME] });
    const metadata = {
      streams: [sub(2, 'eng'), sub(3, 'eng'), sub(4, 'spa'), sub(5, 'spa')],
    };
    const first = await resolveSubtitlePruning(details, '/in.mkv', metadata, signal);
    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(mockCapture.mock.calls[0][2]).toEqual({ extraOutputs: 4 });
    expect([...first].sort()).toEqual([3, 5]);
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0][0]).toBe('[subs] eng 2:3:0.0%=keep 3:3:66.7%=drop (sdh)');
    expect(log.mock.calls[1][0]).toBe('[subs] spa 4:3:0.0%=keep 5:3:0.0%=drop (same as 4)');

    const second = await resolveSubtitlePruning(details, '/in.mkv', metadata, signal);
    expect(second).toEqual(first);
    expect(mockCapture).toHaveBeenCalledTimes(1);
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
    await resolveSubtitlePruning(details, '/in.mkv', metadata, signal);

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
