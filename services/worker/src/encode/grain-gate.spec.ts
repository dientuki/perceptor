// The grain gate fails silently by construction: a wrong weight, a mis-parsed
// field or a path read from the wrong place still produces a plausible score
// and a wrong verdict, and nothing errors. The classic trap is ffprobe's
// avg_frame_rate "24000/1001" (Number() of it is NaN, so every bits-per-pixel
// comparison is false and the density signal quietly never fires). Every
// case below uses real ffprobe-shaped inputs and pins the score, not just the
// verdict.

import { describe, expect, it } from 'vitest';

import { isRemux, type RemuxMetadata } from '../ffmpeg/remux-detection';
import { scoreGrainGate } from './grain-gate';

const PIXELS_1080P = 1920 * 1080;
const NTSC_FILM_FPS = 24000 / 1001;

function metadataFor(
  rawBpppf: number,
  codec = 'h264',
  extra: RemuxMetadata['streams'] = [],
  fps = '24000/1001',
): RemuxMetadata {
  const rate = fps === '24000/1001' ? NTSC_FILM_FPS : Number(fps);
  return {
    streams: [
      {
        codec_type: 'video',
        codec_name: codec,
        width: 1920,
        height: 1080,
        avg_frame_rate: fps,
        bit_rate: String(Math.round(rawBpppf * PIXELS_1080P * rate)),
      },
      ...extra,
    ],
  };
}

const NEUTRAL_PATH = '/downloads/some release/movie.mkv';

describe('scoreGrainGate', () => {
  it('reads "24000/1001" and still reaches the >= 0.20 bpppf tier', () => {
    const result = scoreGrainGate(metadataFor(0.25), NEUTRAL_PATH, null);
    expect(result.score).toBe(2);
    expect(result.passed).toBe(true);
  });

  it('applies the HEVC factor: raw 0.12 normalizes over 0.20', () => {
    const hevc = scoreGrainGate(metadataFor(0.12, 'hevc'), NEUTRAL_PATH, null);
    const h264 = scoreGrainGate(metadataFor(0.12, 'h264'), NEUTRAL_PATH, null);
    expect(hevc.score).toBe(2);
    expect(h264.score).toBe(0);
  });

  it('applies the AV1 factor and an unknown codec stays at 1.0', () => {
    expect(scoreGrainGate(metadataFor(0.09, 'av1'), NEUTRAL_PATH, null).score).toBe(2);
    expect(scoreGrainGate(metadataFor(0.12, 'prores'), NEUTRAL_PATH, null).score).toBe(0);
  });

  it('scores 0 in the 0.07-0.13 dead zone and -2 below 0.07', () => {
    const dead = scoreGrainGate(metadataFor(0.1), NEUTRAL_PATH, null);
    expect(dead.score).toBe(0);
    expect(dead.reasons).toEqual([]);
    expect(scoreGrainGate(metadataFor(0.05), NEUTRAL_PATH, null).score).toBe(-2);
  });

  it('scores the 0.13-0.20 tier as +1', () => {
    expect(scoreGrainGate(metadataFor(0.15), NEUTRAL_PATH, null).score).toBe(1);
  });

  it('scores 0 for the density signal when bpppf cannot be computed', () => {
    const metadata: RemuxMetadata = { streams: [{ codec_type: 'video', codec_name: 'h264' }] };
    expect(scoreGrainGate(metadata, NEUTRAL_PATH, null).score).toBe(0);
  });

  it('counts flac as lossless here while isRemux is unchanged', () => {
    const metadata = metadataFor(0.1, 'h264', [{ codec_type: 'audio', codec_name: 'flac' }]);
    expect(scoreGrainGate(metadata, NEUTRAL_PATH, null).score).toBe(1);
    expect(isRemux(metadata, 'movie.mkv')).toBe(false);
  });

  it('counts truehd as lossless through isLosslessAudioStream', () => {
    const metadata = metadataFor(0.1, 'h264', [{ codec_type: 'audio', codec_name: 'truehd' }]);
    expect(scoreGrainGate(metadata, NEUTRAL_PATH, null).score).toBe(1);
  });

  it('finds a disc marker present only in the parent directory name', () => {
    const result = scoreGrainGate(metadataFor(0.1), '/dl/Movie.2018.UHD.BluRay.x265/movie.mkv', null);
    expect(result.score).toBe(1);
  });

  it('subtracts for a streaming marker in the directory name', () => {
    const result = scoreGrainGate(metadataFor(0.1), '/dl/Movie.AMZN.WEB-DL/movie.mkv', null);
    expect(result.score).toBe(-1);
  });

  it('ignores markers above the parent directory', () => {
    const result = scoreGrainGate(metadataFor(0.1), '/remux/bluray/plain dir/movie.mkv', null);
    expect(result.score).toBe(0);
  });

  it('scores year 1998 with a neutral file name the same as a path containing 1998', () => {
    const fromArgument = scoreGrainGate(metadataFor(0.1), '/dl/mipeli.mkv', 1998);
    const fromPath = scoreGrainGate(metadataFor(0.1), '/dl/Film 1998/film 1998.mkv', 1998);
    expect(fromArgument.score).toBe(1);
    expect(fromArgument.reasons).toEqual(fromPath.reasons);
  });

  it('gives no year signal for a year in the path when year is null', () => {
    const result = scoreGrainGate(metadataFor(0.1), '/dl/Film 1998/film 1998.mkv', null);
    expect(result.score).toBe(0);
  });

  it('gives no year signal from 2002 onward', () => {
    expect(scoreGrainGate(metadataFor(0.1), NEUTRAL_PATH, 2002).score).toBe(0);
    expect(scoreGrainGate(metadataFor(0.1), NEUTRAL_PATH, 2001).score).toBe(1);
  });

  it('adds +3 for tune=grain in a stream tag, case-insensitively', () => {
    const metadata = metadataFor(0.1);
    metadata.streams[0].tags = { ENCODER_OPTIONS: 'crf=18 Tune=Grain' };
    expect(scoreGrainGate(metadata, NEUTRAL_PATH, null).score).toBe(3);
  });

  it('adds +3 for the largest film-grain=N > 0 in a format tag and nothing for 0', () => {
    const withGrain = metadataFor(0.1);
    withGrain.format = { tags: { encoder: 'svtav1 film-grain=0 film-grain=12' } };
    expect(scoreGrainGate(withGrain, NEUTRAL_PATH, null).reasons).toContain('encoder film-grain=12: +3');

    const zero = metadataFor(0.1);
    zero.format = { tags: { encoder: 'film-grain=0' } };
    expect(scoreGrainGate(zero, NEUTRAL_PATH, null).score).toBe(0);
  });

  it('passes at exactly 2 and fails at 1', () => {
    const atTwo = scoreGrainGate(metadataFor(0.1), '/dl/Movie.BluRay/movie.mkv', 1990);
    expect(atTwo.score).toBe(2);
    expect(atTwo.passed).toBe(true);

    const atOne = scoreGrainGate(metadataFor(0.1), '/dl/Movie.BluRay/movie.mkv', null);
    expect(atOne.score).toBe(1);
    expect(atOne.passed).toBe(false);
  });
});
