// Defends REQ-10: isRemux must classify from ffprobe metadata, not the
// filename, and must parse avg_frame_rate as the rational string ffprobe
// actually reports ("24000/1001"). Number("24000/1001") is NaN, which makes
// bits-per-pixel-per-frame NaN, every comparison false, and every file —
// including real 1080p remuxes — classify as non-remux forever, with the
// job still completing and no error in any log (the archetypal Article IX
// bug this suite exists to catch).

import { describe, expect, it } from 'vitest';
import { isRemux, type RemuxMetadata } from './remux-detection';

function videoStream(overrides: Record<string, any> = {}) {
  return {
    codec_type: 'video' as const,
    codec_name: 'h264',
    width: 1920,
    height: 1080,
    avg_frame_rate: '24/1',
    ...overrides,
  };
}

function audioStream(overrides: Record<string, any> = {}) {
  return {
    codec_type: 'audio' as const,
    codec_name: 'ac3',
    ...overrides,
  };
}

describe('isRemux', () => {
  it('treats a truehd audio track as a remux regardless of video bitrate', () => {
    const metadata: RemuxMetadata = {
      streams: [
        videoStream({ bit_rate: '1000' }), // deliberately low, must not matter
        audioStream({ codec_name: 'truehd' }),
      ],
    };

    expect(isRemux(metadata, 'Some.Movie.WEBRip.mkv')).toBe(true);
  });

  it('treats a dts track with a DTS-HD MA profile as a remux', () => {
    const metadata: RemuxMetadata = {
      streams: [
        videoStream({ bit_rate: '1000' }),
        audioStream({ codec_name: 'dts', profile: 'DTS-HD MA' }),
      ],
    };

    expect(isRemux(metadata, 'Some.Movie.WEBRip.mkv')).toBe(true);
  });

  it('does not treat a plain dts track (no MA profile) as lossless by itself', () => {
    const metadata: RemuxMetadata = {
      streams: [
        videoStream({ bit_rate: '8000000' }), // 8 Mbps, below threshold
        audioStream({ codec_name: 'dts', profile: 'DTS' }),
      ],
    };

    expect(isRemux(metadata, 'Some.Movie.WEBRip.mkv')).toBe(false);
  });

  it('treats a pcm_s24le track as lossless audio', () => {
    const metadata: RemuxMetadata = {
      streams: [
        videoStream({ bit_rate: '1000' }),
        audioStream({ codec_name: 'pcm_s24le' }),
      ],
    };

    expect(isRemux(metadata, 'Some.Movie.WEBRip.mkv')).toBe(true);
  });

  it('classifies a 1080p stream at 30 Mbps with a rational avg_frame_rate as a remux', () => {
    // 1920*1080 = 2,073,600 px; 24000/1001 ~= 23.976 fps;
    // 30,000,000 / (2,073,600 * 23.976) ~= 0.60 bpp/frame >= 0.25.
    const metadata: RemuxMetadata = {
      streams: [
        videoStream({
          bit_rate: '30000000',
          avg_frame_rate: '24000/1001',
        }),
      ],
    };

    expect(isRemux(metadata, 'Some.Movie.Blu-ray.mkv')).toBe(true);
  });

  it('fails to detect that same 30 Mbps remux if avg_frame_rate is parsed with Number() instead of as a fraction', () => {
    // This is the regression the fix defends against: Number("24000/1001")
    // is NaN, so the buggy implementation below always falls through to the
    // filename, which in this case does not contain "remux" either — the
    // file is misclassified as non-remux with no error anywhere.
    const buggyIsRemux = (metadata: RemuxMetadata, filename: string): boolean => {
      const video = metadata.streams.find((s) => s.codec_type === 'video')!;
      const pixels = Number(video.width) * Number(video.height);
      const frameRate = Number(video.avg_frame_rate); // the bug: NaN for "24000/1001"
      const bitRate = Number(video.bit_rate);
      const bpp = bitRate / pixels / frameRate;
      if (Number.isFinite(bpp)) return bpp >= 0.25;
      return filename.toLowerCase().includes('remux');
    };

    const metadata: RemuxMetadata = {
      streams: [
        videoStream({
          bit_rate: '30000000',
          avg_frame_rate: '24000/1001',
        }),
      ],
    };

    // Prove the mistake really does misclassify this exact fixture...
    expect(buggyIsRemux(metadata, 'Some.Movie.Blu-ray.mkv')).toBe(false);
    // ...while the real implementation gets it right.
    expect(isRemux(metadata, 'Some.Movie.Blu-ray.mkv')).toBe(true);
  });

  it('does not classify an 8 Mbps 1080p web-DL as a remux', () => {
    // 8,000,000 / (2,073,600 * 24) ~= 0.16 bpp/frame < 0.25.
    const metadata: RemuxMetadata = {
      streams: [
        videoStream({
          bit_rate: '8000000',
          avg_frame_rate: '24/1',
        }),
      ],
    };

    expect(isRemux(metadata, 'Some.Movie.WEB-DL.mkv')).toBe(false);
  });

  it('classifies a UHD stream at 60 Mbps as a remux', () => {
    // 3840*2160 = 8,294,400 px; 60,000,000 / (8,294,400 * 24) ~= 0.30 >= 0.25.
    const metadata: RemuxMetadata = {
      streams: [
        videoStream({
          width: 3840,
          height: 2160,
          bit_rate: '60000000',
          avg_frame_rate: '24/1',
        }),
      ],
    };

    expect(isRemux(metadata, 'Some.Movie.UHD.mkv')).toBe(true);
  });

  it('falls back to the tags.BPS tag when bit_rate is absent', () => {
    const metadata: RemuxMetadata = {
      streams: [
        videoStream({
          bit_rate: undefined,
          avg_frame_rate: '24000/1001',
          tags: { BPS: '30000000' },
        }),
      ],
    };

    expect(isRemux(metadata, 'Some.Movie.Blu-ray.mkv')).toBe(true);
  });

  it('falls back to format.size / format.duration when bit_rate and BPS are both absent', () => {
    // Target ~30 Mbps over a 1 hour (3600s) file:
    // size (bytes) = bitrate * duration / 8 = 30,000,000 * 3600 / 8 = 13,500,000,000
    const metadata: RemuxMetadata = {
      streams: [
        videoStream({
          bit_rate: undefined,
          avg_frame_rate: '24000/1001',
        }),
      ],
      format: {
        size: '13500000000',
        duration: '3600',
      },
    };

    expect(isRemux(metadata, 'Some.Movie.Blu-ray.mkv')).toBe(true);
  });

  it('falls back to the filename only when no bitrate can be computed at all', () => {
    const metadata: RemuxMetadata = {
      streams: [
        videoStream({
          bit_rate: undefined,
          avg_frame_rate: '24000/1001',
        }),
      ],
    };

    expect(isRemux(metadata, 'Some.Movie.REMUX.mkv')).toBe(true);
    expect(isRemux(metadata, 'Some.Movie.WEB-DL.mkv')).toBe(false);
  });
});
