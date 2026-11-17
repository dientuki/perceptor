// Subtitle content pruning fails silently in both directions: reading the wrong
// tracks (indices that differ from the ones the command later maps) drops a
// good track or keeps clutter, and a read failure that throws instead of
// keeping everything would fail an encode over a luxury. The resolver is tested
// with the FFmpeg spawn mocked: no spawn and no log when no language has a
// choice, the sample limit as an output option (never before -i, where it would
// not bound the extracted track), failures degrade to "keep everything" and are
// never cached, a cancellation propagates, and the candidate indices it reads
// equal the ones getSubtitleParams maps for the same input.
//
// The subtitle-variant cases defend against a regional variant that is silently
// never decided, or decided from the wrong tracks: one shared read for the
// union of streams, pair versus lone decisions, an undecided verdict that is
// stored, the opt-in gate, and failures that keep the drops already known.

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
    const { drops } = await resolveSubtitlePruning(details, file, metadata, signal);
    expect(drops.size).toBe(0);
    expect(mockCapture).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('returns an empty set plus one failure line when ffmpeg exits non-zero', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockCapture.mockResolvedValue({ code: 1, stdoutBytes: 0, stderr: '' });
    const metadata = { streams: [sub(2, 'eng'), sub(3, 'eng')] };
    const { drops } = await resolveSubtitlePruning(details, file, metadata, signal);
    expect(drops.size).toBe(0);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toMatch(/^\[subs\] read failed: /);
  });

  it('returns an empty set plus one failure line when the spawn rejects', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockCapture.mockRejectedValue(new Error('spawn ENOENT'));
    const metadata = { streams: [sub(2, 'eng'), sub(3, 'eng')] };
    const { drops } = await resolveSubtitlePruning(details, file, metadata, signal);
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
    expect((await resolveSubtitlePruning(details, file, metadata, signal)).drops.size).toBe(0);
    expect([...(await resolveSubtitlePruning(details, file, metadata, signal)).drops]).toEqual([3]);
    expect(mockCapture).toHaveBeenCalledTimes(2);
  });

  it('logs one line per group on success and reuses the verdict without spawning again', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockCapture.mockResolvedValue({ code: 0, stdoutBytes: 0, stderr: '', outputs: [SAME, SDH, SAME, SAME] });
    const metadata = {
      streams: [sub(2, 'eng'), sub(3, 'eng'), sub(4, 'spa'), sub(5, 'spa')],
    };
    const first = (await resolveSubtitlePruning(details, file, metadata, signal)).drops;
    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(mockCapture.mock.calls[0][2]).toEqual({ extraOutputs: 4 });
    expect([...first].sort()).toEqual([3, 5]);
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0][0]).toBe('[subs] eng 2:3:0.0%=keep 3:3:66.7%=drop (sdh)');
    expect(log.mock.calls[1][0]).toBe('[subs] spa 4:3:0.0%=keep 5:3:0.0%=drop (same as 4)');

    const second = (await resolveSubtitlePruning(details, file, metadata, signal)).drops;
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
    const again = (await resolveSubtitlePruning(details, file, metadata, signal)).drops;
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

function longSrt(make: (i: number) => string, count = 150): string {
  const stamp = (t: number) => {
    const m = Math.floor(t / 60);
    return `00:${String(m).padStart(2, '0')}:${String(t % 60).padStart(2, '0')},000`;
  };
  return Array.from({ length: count }, (_, i) => `${i + 1}\n${stamp(i * 4)} --> ${stamp(i * 4 + 2)}\n${make(i)}\n`).join('\n');
}

const SPAIN = longSrt((i) => `Vosotros ya habéis visto el coche número ${i} de la casa`);
const LATIN = longSrt((i) => `La casa número ${i} está en la calle de enfrente hoy`);
const SPAIN_S = longSrt((i) => `Vosotros ya habéis visto el coche número ${i} de la casa`, 30);
const LATIN_S = longSrt((i) => `La casa número ${i} está en la calle de enfrente hoy`, 30);
const SPAIN_TWO = longSrt((i) => `Vosotros ya habéis visto la moto número ${i} de la plaza`);
const LATIN_TWO_S = longSrt((i) => `El perro número ${i} duerme en el patio de atrás hoy`, 30);
const SHORT_LATIN = longSrt((i) => `La casa número ${i} está en la calle`, 20);

const optIn = { ...details, subtitleVariantDetection: true };
const spa = (index: number, extra: Record<string, unknown> = {}) => sub(index, 'spa', extra);

function variantEntries(): string[] {
  return [...redis.entries.keys()].filter((k) => k.includes(':subtitle-variant:'));
}

describe('resolveSubtitlePruning, subtitle variants', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  // Spec 118, REQ-6 NFR-1
  it('compares two unresolved text tracks as a pair with a single read', async () => {
    mockCapture.mockResolvedValue({ code: 0, stdoutBytes: 0, stderr: '', outputs: [LATIN_S, SPAIN_S] });
    const { variants } = await resolveSubtitlePruning(optIn, file, { streams: [spa(2), spa(3)] }, signal);
    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(mockCapture.mock.calls[0][2]).toEqual({ extraOutputs: 2 });
    expect([...variants]).toEqual([[3, 'es-ES'], [2, 'es-419']].sort((a, b) => Number(a[0]) - Number(b[0])));
  });

  // Spec 118, REQ-6b
  it('decides a lone track of a single-track language absolutely, reading just that track', async () => {
    mockCapture.mockResolvedValue({ code: 0, stdoutBytes: 0, stderr: '', outputs: [SPAIN] });
    const { variants } = await resolveSubtitlePruning(optIn, file, { streams: [sub(2, 'eng'), spa(3)] }, signal);
    const args = mockCapture.mock.calls[0][0];
    expect(args.filter((a) => a === '-map')).toHaveLength(1);
    expect(args).toContain('0:3');
    expect([...variants]).toEqual([[3, 'es-ES']]);
  });

  // Spec 118, REQ-6b
  it('decides three unresolved tracks each on its own with no pairwise comparison', async () => {
    mockCapture.mockResolvedValue({ code: 0, stdoutBytes: 0, stderr: '', outputs: [SPAIN, LATIN, SPAIN_TWO] });
    const { variants } = await resolveSubtitlePruning(optIn, file, { streams: [spa(2), spa(3), spa(4)] }, signal);
    expect(variants.get(2)).toBe('es-ES');
    expect(variants.get(3)).toBe('es-419');
    expect(variants.get(4)).toBe('es-ES');
    expect(variantEntries()).toHaveLength(3);
  });

  // Spec 118, REQ-6b
  it('stores an undecided verdict for a lone track below the minimum word count', async () => {
    mockCapture.mockResolvedValue({ code: 0, stdoutBytes: 0, stderr: '', outputs: [SHORT_LATIN] });
    const { variants } = await resolveSubtitlePruning(optIn, file, { streams: [spa(2)] }, signal);
    expect(variants.size).toBe(0);
    const stored = variantEntries();
    expect(stored).toHaveLength(1);
    expect(JSON.parse(redis.entries.get(stored[0])!)).toEqual({ undecided: true });
    await resolveSubtitlePruning(optIn, file, { streams: [spa(2)] }, signal);
    expect(mockCapture).toHaveBeenCalledTimes(1);
  });

  // Spec 118, REQ-8 NFR-1
  it('stores an undecided pair and does not read it again', async () => {
    mockCapture.mockResolvedValue({ code: 0, stdoutBytes: 0, stderr: '', outputs: [LATIN_S, LATIN_TWO_S] });
    const metadata = { streams: [spa(2), spa(3)] };
    const first = await resolveSubtitlePruning(optIn, file, metadata, signal);
    expect(first.variants.size).toBe(0);
    expect(variantEntries()).toHaveLength(1);
    await resolveSubtitlePruning(optIn, file, metadata, signal);
    expect(mockCapture).toHaveBeenCalledTimes(1);
  });

  // Spec 118, REQ-8 NFR-1
  it('reads only the candidates when the drops are stored and the variant verdict misses', async () => {
    const metadata = { streams: [spa(2), spa(3)] };
    mockCapture.mockResolvedValueOnce({ code: 0, stdoutBytes: 0, stderr: '', outputs: [LATIN_S, SPAIN_S] });
    await resolveSubtitlePruning(details, file, metadata, signal);
    mockCapture.mockResolvedValueOnce({ code: 0, stdoutBytes: 0, stderr: '', outputs: [LATIN_S, SPAIN_S] });
    const { variants } = await resolveSubtitlePruning(optIn, file, metadata, signal);
    expect(mockCapture).toHaveBeenCalledTimes(2);
    expect(mockCapture.mock.calls[1][2]).toEqual({ extraOutputs: 2 });
    expect(variants.get(3)).toBe('es-ES');
  });

  // Spec 118, REQ-8 NFR-1
  it('makes no read when both the drops and the variant verdict are stored', async () => {
    const metadata = { streams: [spa(2), spa(3)] };
    mockCapture.mockResolvedValue({ code: 0, stdoutBytes: 0, stderr: '', outputs: [LATIN_S, SPAIN_S] });
    const first = await resolveSubtitlePruning(optIn, file, metadata, signal);
    const second = await resolveSubtitlePruning(optIn, file, metadata, signal);
    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect([...second.variants]).toEqual([...first.variants]);
  });

  // Spec 118, REQ-5
  it('does no detection for a titled pair or a PGS pair', async () => {
    const titled = { streams: [spa(2, { tags: { language: 'spa', title: 'Latino', NUMBER_OF_FRAMES: '500' } }), spa(3, { tags: { language: 'spa', title: 'Castellano', NUMBER_OF_FRAMES: '500' } })] };
    expect((await resolveSubtitlePruning(optIn, file, titled, signal)).variants.size).toBe(0);
    const pgs = { streams: [spa(2, { codec_name: 'hdmv_pgs_subtitle' }), spa(3, { codec_name: 'hdmv_pgs_subtitle' })] };
    expect((await resolveSubtitlePruning(optIn, file, pgs, signal)).variants.size).toBe(0);
    expect(variantEntries()).toHaveLength(0);
    const variantReads = mockCapture.mock.calls.filter((c) => c[0].includes('0:2') && !c[0].includes('0:3'));
    expect(variantReads).toHaveLength(0);
  });

  // Spec 118, REQ-5
  it('does not detect or read a subtitle-variant verdict when the opt-in is false', async () => {
    mockCapture.mockResolvedValue({ code: 0, stdoutBytes: 0, stderr: '', outputs: [LATIN_S, SPAIN_S] });
    const metadata = { streams: [spa(2), spa(3)] };
    await resolveSubtitlePruning(optIn, file, metadata, signal);
    mockCapture.mockClear();
    const stored = new FakeRedis();
    const reads: string[] = [];
    installVerdictStore({
      get: async (key) => {
        reads.push(key);
        return redis.entries.get(key) ?? stored.entries.get(key) ?? null;
      },
      set: async () => 'OK',
    });
    const { variants } = await resolveSubtitlePruning(details, file, metadata, signal);
    expect(variants.size).toBe(0);
    expect(mockCapture).not.toHaveBeenCalled();
    expect(reads.some((k) => k.includes(':subtitle-variant:'))).toBe(false);
  });

  // Spec 118, REQ-9
  it('still returns the drops and stores no variant when the read fails', async () => {
    mockCapture.mockResolvedValue({ code: 1, stdoutBytes: 0, stderr: '' });
    const { drops, variants } = await resolveSubtitlePruning(optIn, file, { streams: [spa(2), spa(3)] }, signal);
    expect(drops.size).toBe(0);
    expect(variants.size).toBe(0);
    expect(redis.entries.size).toBe(0);
  });

  // Spec 118, REQ-9
  it('keeps the stored drops when only the variant read fails', async () => {
    const metadata = { streams: [spa(2), spa(3), spa(4)] };
    mockCapture.mockResolvedValueOnce({ code: 0, stdoutBytes: 0, stderr: '', outputs: [LATIN, SDH, SPAIN] });
    const first = await resolveSubtitlePruning(details, file, metadata, signal);
    expect([...first.drops]).toEqual([3]);
    mockCapture.mockResolvedValueOnce({ code: 1, stdoutBytes: 0, stderr: '' });
    const second = await resolveSubtitlePruning(optIn, file, metadata, signal);
    expect([...second.drops]).toEqual([3]);
    expect(second.variants.size).toBe(0);
    expect(variantEntries()).toHaveLength(0);
  });

  // Spec 118, REQ-9
  it('propagates a cancellation raised during a variant read', async () => {
    mockCapture.mockRejectedValue(new EncodeCancelledError());
    await expect(
      resolveSubtitlePruning(optIn, file, { streams: [spa(2)] }, signal),
    ).rejects.toBeInstanceOf(EncodeCancelledError);
  });

  // Spec 118, REQ-8
  it('misses for a different file', async () => {
    mockCapture.mockResolvedValue({ code: 0, stdoutBytes: 0, stderr: '', outputs: [LATIN_S, SPAIN_S] });
    const metadata = { streams: [spa(2), spa(3)] };
    await resolveSubtitlePruning(optIn, file, metadata, signal);
    const other = join(dir, 'other.mkv');
    writeFileSync(other, 'yy');
    await resolveSubtitlePruning(optIn, other, metadata, signal);
    expect(mockCapture).toHaveBeenCalledTimes(2);
  });
});

