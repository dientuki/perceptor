// Defends REQ-9: the CRF must land on the right value, evaluated in this
// order — non-live-action first (even on a remux), then remux, then
// everything else. Before this fix `buildFfmpegCommand` guessed "remux" from
// the filename substring, so a correctly named release that omitted the word
// silently got the web-grade CRF, and the job still completed with no error
// in any log (Constitution, Article IX).

import { afterEach, describe, expect, it } from 'vitest';
import { buildFfmpegCommand } from './buildCommand';
import type { EncodeInput } from '../encode/types';

function details(overrides: Partial<EncodeInput> = {}): EncodeInput {
  return {
    originalLanguageIso3: 'eng',
    allowedLanguagesIso3: ['eng'],
    isLiveAction: true,
    ...overrides,
  };
}

function videoStream(overrides: Record<string, any> = {}) {
  return {
    index: 0,
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
    index: 1,
    codec_type: 'audio' as const,
    codec_name: 'ac3',
    channels: 2,
    tags: { language: 'eng' },
    ...overrides,
  };
}

function crfOf(args: string[]): string | undefined {
  const i = args.indexOf('-crf');
  return i === -1 ? undefined : args[i + 1];
}

describe('buildFfmpegCommand — CRF selection (REQ-9)', () => {
  afterEach(() => {
    delete process.env.ENCODE_SAMPLE_SECONDS;
  });

  it('uses -crf 20 for a non-live-action title even on a remux', () => {
    const metadata = {
      streams: [
        videoStream({ bit_rate: '1000' }), // deliberately low, must not matter
        audioStream({ codec_name: 'truehd' }), // makes it a remux
      ],
    };

    const args = buildFfmpegCommand(
      'Some.Anime.Movie.mkv',
      '/out/Some.Anime.Movie.mkv',
      metadata,
      details({ isLiveAction: false }),
      false,
    );

    expect(crfOf(args)).toBe('20');
  });

  it('uses -crf 22 for a live-action remux (detected from metadata, not the filename)', () => {
    const metadata = {
      streams: [
        videoStream({ bit_rate: '1000' }),
        audioStream({ codec_name: 'truehd' }),
      ],
    };

    // Filename deliberately omits "remux" — REQ-10 forbids relying on it here.
    const args = buildFfmpegCommand(
      'Some.Movie.Blu-ray.mkv',
      '/out/Some.Movie.Blu-ray.mkv',
      metadata,
      details({ isLiveAction: true }),
      false,
    );

    expect(crfOf(args)).toBe('22');
  });

  it('uses -crf 24 for a live-action web-DL', () => {
    const metadata = {
      streams: [
        videoStream({ bit_rate: '8000000', avg_frame_rate: '24/1' }), // ~0.16 bpp/frame, below threshold
        audioStream({ codec_name: 'ac3' }),
      ],
    };

    const args = buildFfmpegCommand(
      'Some.Movie.WEB-DL.mkv',
      '/out/Some.Movie.WEB-DL.mkv',
      metadata,
      details({ isLiveAction: true }),
      false,
    );

    expect(crfOf(args)).toBe('24');
  });

  it('still appends -t when ENCODE_SAMPLE_SECONDS is set', () => {
    process.env.ENCODE_SAMPLE_SECONDS = '5';

    const metadata = {
      streams: [
        videoStream({ bit_rate: '8000000' }),
        audioStream({ codec_name: 'ac3' }),
      ],
    };

    const args = buildFfmpegCommand(
      'Some.Movie.WEB-DL.mkv',
      '/out/Some.Movie.WEB-DL.mkv',
      metadata,
      details({ isLiveAction: true }),
      false,
    );

    const i = args.indexOf('-t');
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toBe('5');
  });

  it('forwards allowedLanguagesIso3 into the audio arguments', () => {
    const metadata = {
      streams: [
        videoStream({ bit_rate: '8000000' }),
        audioStream({ codec_name: 'ac3', tags: { language: 'eng' } }),
        audioStream({ index: 2, codec_name: 'ac3', channels: 6, tags: { language: 'spa' } }),
      ],
    };

    const args = buildFfmpegCommand(
      'Some.Movie.WEB-DL.mkv',
      '/out/Some.Movie.WEB-DL.mkv',
      metadata,
      details({
        originalLanguageIso3: 'eng',
        allowedLanguagesIso3: ['eng', 'spa'],
      }),
      false,
    );

    // One -map per selected audio stream: 0:0 (video) implicitly handled by
    // getVideoParams, plus 0:1 (eng) and 0:2 (spa) from getAudioParams.
    expect(args).toContain('0:1');
    expect(args).toContain('0:2');
    expect(args.filter((a) => a === '-metadata:s:a:0').length).toBeGreaterThan(0);
    expect(args.filter((a) => a === '-metadata:s:a:1').length).toBeGreaterThan(0);
  });

  it('threads the vulkanAvailable argument through to getVideoParams', () => {
    const metadata = {
      streams: [
        videoStream({
          codec_name: 'hevc',
          width: 3840,
          height: 2160,
          color_transfer: 'smpte2084',
        }),
        audioStream({ codec_name: 'ac3' }),
      ],
    };

    const vfOf = (args: string[]) => args[args.indexOf('-vf') + 1];

    const withGpu = buildFfmpegCommand(
      'Some.Movie.HDR10.mkv',
      '/out/Some.Movie.HDR10.mkv',
      metadata,
      details({ isLiveAction: true }),
      true,
    );

    const withoutGpu = buildFfmpegCommand(
      'Some.Movie.HDR10.mkv',
      '/out/Some.Movie.HDR10.mkv',
      metadata,
      details({ isLiveAction: true }),
      false,
    );

    expect(vfOf(withGpu)).toContain('libplacebo');
    expect(vfOf(withoutGpu)).not.toContain('libplacebo');
    expect(vfOf(withoutGpu)).toContain('zscale');
  });
});
