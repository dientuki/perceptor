// Stream-end trim fails silently in both directions: a wrong cut deletes real
// content from the end of a title, a missed one keeps minutes of picture with
// no sound (or sound with no picture), and neither raises an error anywhere.
// The cut rule is tested against the track ends recorded on 2026-10-19 from
// real files (Voltron, Lost in Space, Star Wars, They Will Kill You, The Help),
// a normal file at 0.3 s, the 2.0 s boundary and The Darkest Hour's
// out-of-window shape. The resolver is tested with the ffprobe spawn mocked:
// a dropped audio track must never move the cut, a failed analysis must be
// silent and encode the whole file, and a cancellation must propagate.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EncodeCancelledError } from './cancellation';
import { decideStreamEndCut, parsePacketEnds, resolveStreamEndTrim } from './stream-end-trim';
import { runFfmpegCapture } from '../ffmpeg/capture';

vi.mock('../ffmpeg/capture', () => ({ runFfmpegCapture: vi.fn() }));

const mockCapture = vi.mocked(runFfmpegCapture);

describe('decideStreamEndCut on recorded track ends', () => {
  it.each([
    ['Voltron S01E01 (audio runs past video)', 4101.138, [4121.76], 4101.138],
    ['Lost in Space S01E01 (video runs past audio)', 3816.188, [3765.455], 3765.455],
    ['Star Wars (cut at the longest audio)', 7330.198, [7268.158, 7267.432], 7268.158],
    ['They Will Kill You (a longer track is cut by video)', 5673.71, [5673.718, 5734.568], 5673.71],
    ['The Help (trailing silent audio)', 8774.975, [8779.815], 8774.975],
  ])('%s', (_name, video, audio, expected) => {
    const decision = decideStreamEndCut(video, audio);
    expect(decision.outOfWindow).toBe(false);
    expect(decision.cut).toBeCloseTo(expected, 3);
  });

  it('keeps a normal file whose tracks differ by 0.3 s', () => {
    expect(decideStreamEndCut(3000.0, [3000.3]).cut).toBeNull();
  });

  it('keeps a file whose tracks differ by exactly 2.0 s', () => {
    const decision = decideStreamEndCut(3000, [3002]);
    expect(decision.cut).toBeNull();
    expect(decision.outOfWindow).toBe(false);
  });

  it('cuts just past the 2 s threshold', () => {
    expect(decideStreamEndCut(3000, [3002.01]).cut).toBeCloseTo(3000, 3);
  });

  it('keeps the file whole when a kept audio track has no packet in the window (Darkest Hour shape)', () => {
    const decision = decideStreamEndCut(5340, [undefined]);
    expect(decision.outOfWindow).toBe(true);
    expect(decision.cut).toBeNull();
  });

  it('keeps the file whole when the video has no packet in the window', () => {
    const decision = decideStreamEndCut(undefined, [5340]);
    expect(decision.outOfWindow).toBe(true);
    expect(decision.cut).toBeNull();
  });

  it('keeps the file whole when one of several kept tracks is out of window', () => {
    expect(decideStreamEndCut(5340, [5340, undefined]).outOfWindow).toBe(true);
  });
});

describe('parsePacketEnds', () => {
  it('reads fields by key, independent of their order', () => {
    const ends = parsePacketEnds(
      [
        'packet|stream_index=1|pts_time=10.000000|duration_time=0.020000',
        'packet|duration_time=0.500000|pts_time=20.000000|stream_index=0',
      ].join('\n'),
    );
    expect(ends.get(1)).toBeCloseTo(10.02, 6);
    expect(ends.get(0)).toBeCloseTo(20.5, 6);
  });

  it('treats an N/A duration as zero', () => {
    const ends = parsePacketEnds('packet|stream_index=0|pts_time=12.500000|duration_time=N/A');
    expect(ends.get(0)).toBe(12.5);
  });

  it('skips a packet whose pts_time is not numeric', () => {
    const ends = parsePacketEnds(
      ['packet|stream_index=0|pts_time=N/A|duration_time=1.0', 'packet|stream_index=0|pts_time=5.0|duration_time=1.0'].join('\n'),
    );
    expect(ends.get(0)).toBe(6);
  });

  it('keeps the maximum end per stream when packets arrive out of order', () => {
    const ends = parsePacketEnds(
      [
        'packet|stream_index=0|pts_time=100.083|duration_time=0.041',
        'packet|stream_index=0|pts_time=100.000|duration_time=0.041',
        'packet|stream_index=0|pts_time=100.042|duration_time=0.041',
      ].join('\n'),
    );
    expect(ends.get(0)).toBeCloseTo(100.124, 6);
  });

  it('ignores lines that are not packets and returns an empty map for no output', () => {
    expect(parsePacketEnds('').size).toBe(0);
    expect(parsePacketEnds('garbage\nstream|index=0').size).toBe(0);
  });
});

describe('resolveStreamEndTrim', () => {
  const signal = new AbortController().signal;
  const metadata = {
    format: { duration: '4121.760' },
    streams: [
      { index: 0, codec_type: 'video', codec_name: 'h264' },
      { index: 1, codec_type: 'audio', codec_name: 'ac3', channels: 6, tags: { language: 'eng' } },
      { index: 2, codec_type: 'audio', codec_name: 'ac3', channels: 6, tags: { language: 'spa' } },
    ],
  };
  const on = {
    streamEndTrimEnabled: true,
    originalLanguageIso3: 'eng',
    allowedAudioLanguagesIso3: ['eng'],
    allowedAudioLanguageTags: [] as string[],
  };

  function packets(ends: Record<number, number>) {
    const stdout = Object.entries(ends)
      .map(([index, end]) => `packet|stream_index=${index}|pts_time=${end}|duration_time=0`)
      .join('\n');
    return { code: 0, stdoutBytes: stdout.length, stderr: '', stdout };
  }

  beforeEach(() => {
    mockCapture.mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does nothing and spawns nothing when the switch is off', async () => {
    expect(await resolveStreamEndTrim({ ...on, streamEndTrimEnabled: false }, '/a.mkv', metadata, signal)).toBeNull();
    expect(mockCapture).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
  });

  it('returns the cut, logs exactly one line and calls ffprobe with the window', async () => {
    mockCapture.mockResolvedValueOnce(packets({ 0: 4101.138, 1: 4121.76 }));
    const cut = await resolveStreamEndTrim(on, '/a.mkv', metadata, signal);
    expect(cut).toBeCloseTo(4101.138, 3);
    expect(console.log).toHaveBeenCalledTimes(1);
    expect(vi.mocked(console.log).mock.calls[0][0]).toContain('[streamtrim] input=/a.mkv video=4101.138 audio=4121.760 -> cut=4101.138');
    const [args, , options] = mockCapture.mock.calls[0];
    expect(args).toContain('-read_intervals');
    expect(args[args.indexOf('-read_intervals') + 1]).toBe('3821.760%');
    expect(options).toEqual({ binary: 'ffprobe', keepStdout: true });
  });

  it('logs keep for a normal file', async () => {
    mockCapture.mockResolvedValueOnce(packets({ 0: 4121.5, 1: 4121.76 }));
    expect(await resolveStreamEndTrim(on, '/a.mkv', metadata, signal)).toBeNull();
    expect(vi.mocked(console.log).mock.calls[0][0]).toContain('-> keep');
    expect(vi.mocked(console.log).mock.calls[0][0]).not.toContain('out of window');
  });

  it('logs keep (out of window) when a kept audio track has no packet in the window', async () => {
    mockCapture.mockResolvedValueOnce(packets({ 0: 4121.5 }));
    expect(await resolveStreamEndTrim(on, '/a.mkv', metadata, signal)).toBeNull();
    expect(vi.mocked(console.log).mock.calls[0][0]).toContain('-> keep (out of window)');
  });

  it('ignores a dropped audio track even when it is the longest (REQ-7)', async () => {
    // Spanish (index 2) is not allowed, so its 4181.0 s end must not move the cut.
    mockCapture.mockResolvedValueOnce(packets({ 0: 4101.138, 1: 4101.2, 2: 4181 }));
    const cut = await resolveStreamEndTrim(on, '/a.mkv', metadata, signal);
    expect(cut).toBeNull();
    expect(vi.mocked(console.log).mock.calls[0][0]).toContain('audio=4101.200');
  });

  it('counts the dropped track once it is allowed (control for the case above)', async () => {
    mockCapture.mockResolvedValueOnce(packets({ 0: 4101.138, 1: 4101.2, 2: 4181 }));
    const cut = await resolveStreamEndTrim(
      { ...on, allowedAudioLanguagesIso3: ['eng', 'spa'] },
      '/a.mkv',
      metadata,
      signal,
    );
    expect(cut).toBeCloseTo(4101.138, 3);
  });

  it('treats a cut at or below zero as keep', async () => {
    mockCapture.mockResolvedValueOnce(packets({ 0: 0, 1: 100 }));
    expect(await resolveStreamEndTrim(on, '/a.mkv', metadata, signal)).toBeNull();
  });

  it.each([
    ['ffprobe exits non-zero', () => mockCapture.mockResolvedValueOnce({ code: 1, stdoutBytes: 0, stderr: '', stdout: '' })],
    ['the spawn rejects', () => mockCapture.mockRejectedValueOnce(new Error('spawn ENOENT'))],
  ])('returns null silently when %s', async (_name, arrange) => {
    arrange();
    expect(await resolveStreamEndTrim(on, '/a.mkv', metadata, signal)).toBeNull();
    expect(console.log).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('returns null silently when no audio track is selected', async () => {
    const noAudio = { ...metadata, streams: [metadata.streams[0]] };
    expect(await resolveStreamEndTrim(on, '/a.mkv', noAudio, signal)).toBeNull();
    expect(mockCapture).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('returns null silently when the container duration is unreadable', async () => {
    expect(await resolveStreamEndTrim(on, '/a.mkv', { ...metadata, format: {} }, signal)).toBeNull();
    expect(mockCapture).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
  });

  it('propagates a cancellation', async () => {
    mockCapture.mockRejectedValueOnce(new EncodeCancelledError());
    await expect(resolveStreamEndTrim(on, '/a.mkv', metadata, signal)).rejects.toBeInstanceOf(EncodeCancelledError);
    expect(console.log).not.toHaveBeenCalled();
  });
});
