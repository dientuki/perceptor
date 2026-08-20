// Defends src/ffmpeg/params.ts, the most rule-dense file in the worker and
// (per spec.md's Context & Goal) the one with the least test coverage: a
// wrong argument here produces a ProcessJob marked COMPLETED and a file with
// the wrong audio, the wrong subtitles, or the wrong language tags — no
// error in any log (Constitution, Article IX). Every case below reproduces
// one of the ways that used to happen silently: a language dropped because
// nobody normalized ISO-639-2/B vs /T, a commentary track kept because the
// blacklist wasn't applied before ranking, a missing original-language track
// papered over with a copy-all fallback, or an image subtitle emitted as
// text.

import { describe, expect, it } from 'vitest';
import { getAudioParams, getSubtitleParams, getVideoParams } from './params';

function audioStream(overrides: Record<string, any>) {
  return {
    index: 0,
    codec_type: 'audio',
    codec_name: 'ac3',
    channels: 2,
    bit_rate: '192000',
    tags: {},
    ...overrides,
  };
}

function videoStream(overrides: Record<string, any> = {}) {
  return {
    index: 0,
    codec_type: 'video',
    codec_name: 'hevc',
    width: 3840,
    height: 2160,
    side_data_list: [],
    ...overrides,
  };
}

function subtitleStream(overrides: Record<string, any>) {
  return {
    index: 0,
    codec_type: 'subtitle',
    codec_name: 'subrip',
    tags: {},
    ...overrides,
  };
}

function mapArgCount(params: string[]): number {
  return params.filter((arg) => arg === '-map').length;
}

describe('getAudioParams', () => {
  it('emits exactly one -map per allowed language when a track exists for each', () => {
    const streams = [
      audioStream({ index: 1, tags: { language: 'jpn' } }),
      audioStream({ index: 2, tags: { language: 'spa' } }),
      audioStream({ index: 3, tags: { language: 'eng' } }),
    ];

    const params = getAudioParams(streams, ['jpn', 'spa', 'eng'], 'jpn');

    expect(mapArgCount(params)).toBe(3);
  });

  it('omits an allowed language with no matching track, without throwing', () => {
    const streams = [
      audioStream({ index: 1, tags: { language: 'jpn' } }),
      audioStream({ index: 2, tags: { language: 'eng' } }),
    ];

    const params = getAudioParams(streams, ['jpn', 'spa', 'eng'], 'jpn');

    expect(mapArgCount(params)).toBe(2);
    expect(params).toContain('0:1');
    expect(params).toContain('0:2');
  });

  it('never selects a track titled "Director\'s Commentary"', () => {
    const streams = [
      audioStream({ index: 1, tags: { language: 'eng', title: "Director's Commentary" } }),
      audioStream({ index: 2, tags: { language: 'eng', title: 'Original' } }),
    ];

    const params = getAudioParams(streams, ['eng'], 'eng');

    expect(mapArgCount(params)).toBe(1);
    expect(params).toContain('0:2');
    expect(params).not.toContain('0:1');
  });

  it('picks the truehd 5.1 track over an eac3 7.1 track in the same language — codec outranks channels', () => {
    const streams = [
      audioStream({ index: 1, codec_name: 'eac3', channels: 8, tags: { language: 'eng' } }),
      audioStream({ index: 2, codec_name: 'truehd', channels: 6, tags: { language: 'eng' } }),
    ];

    const params = getAudioParams(streams, ['eng'], 'eng');

    expect(mapArgCount(params)).toBe(1);
    expect(params).toContain('0:2');
  });

  it('picks the Latino-titled Spanish track over another Spanish track', () => {
    const streams = [
      audioStream({ index: 1, tags: { language: 'spa', title: 'Spanish (Spain)' } }),
      audioStream({ index: 2, tags: { language: 'spa', title: 'Latino' } }),
    ];

    const params = getAudioParams(streams, ['spa'], 'spa');

    expect(mapArgCount(params)).toBe(1);
    expect(params).toContain('0:2');
  });

  it('throws naming the original iso3 when no track in the original language survives filtering', () => {
    const streams = [audioStream({ index: 1, tags: { language: 'eng' } })];

    expect(() => getAudioParams(streams, ['jpn', 'eng'], 'jpn')).toThrow(/jpn/);
  });

  it('matches an allowed "fre" against a track tagged "fra" (ISO-639-2/T)', () => {
    const streams = [audioStream({ index: 1, tags: { language: 'fra' } })];

    const params = getAudioParams(streams, ['fre'], 'fre');

    expect(mapArgCount(params)).toBe(1);
    expect(params).toContain('0:1');
  });

  it('matches an allowed "fra" against a track tagged "fre" (the reverse pairing)', () => {
    const streams = [audioStream({ index: 1, tags: { language: 'fre' } })];

    const params = getAudioParams(streams, ['fra'], 'fra');

    expect(mapArgCount(params)).toBe(1);
    expect(params).toContain('0:1');
  });
});

describe('getSubtitleParams', () => {
  it('emits zero subtitle arguments when the only tracks are image subtitles (PGS)', () => {
    const streams = [
      subtitleStream({ index: 4, codec_name: 'hdmv_pgs_subtitle', tags: { language: 'eng' } }),
    ];

    const params = getSubtitleParams(streams, ['eng']);

    expect(params).toEqual([]);
  });

  it('drops a subtitle track whose BPS tag is 1', () => {
    const streams = [
      subtitleStream({ index: 4, tags: { language: 'eng', BPS: '1' } }),
    ];

    const params = getSubtitleParams(streams, ['eng']);

    expect(params).toEqual([]);
  });

  it('replaces an ALL-CAPS subtitle title with the language name', () => {
    const streams = [
      subtitleStream({ index: 4, tags: { language: 'eng', title: 'FORCED' } }),
    ];

    const params = getSubtitleParams(streams, ['eng']);

    expect(params).toContain('title=English');
  });

  // The corpus covers hearing-impaired tracks that carry the disposition flag
  // (3.json sets it and titles itself SDH). No real file here tags it in the
  // title alone, and no real file offers a hearing-impaired track as the only
  // candidate — both are the cases where dropping it outright, instead of
  // ranking it last, would silently ship a file with no subtitle at all.
  it('drops a hearing-impaired track detected by title alone when another candidate exists', () => {
    const streams = [
      subtitleStream({ index: 4, tags: { language: 'eng', title: 'English SDH' } }),
      subtitleStream({ index: 5, tags: { language: 'eng', title: 'English' } }),
    ];

    const params = getSubtitleParams(streams, ['eng']);

    expect(mapArgCount(params)).toBe(1);
    expect(params).toContain('0:5');
  });

  it('keeps a hearing-impaired track when it is the only candidate in its language', () => {
    const streams = [
      subtitleStream({ index: 4, tags: { language: 'eng', title: 'SDH' }, disposition: { hearing_impaired: 1 } }),
    ];

    const params = getSubtitleParams(streams, ['eng']);

    expect(mapArgCount(params)).toBe(1);
    expect(params).toContain('0:4');
  });

  it('keeps every Spanish track when nothing marks any of them as regional', () => {
    const streams = [
      subtitleStream({ index: 4, tags: { language: 'spa', title: 'BTM' } }),
      subtitleStream({ index: 5, tags: { language: 'spa', title: 'BTM' } }),
    ];

    const params = getSubtitleParams(streams, ['spa']);

    expect(mapArgCount(params)).toBe(2);
    expect(params.filter((arg) => arg === 'title=Español')).toHaveLength(2);
  });

  it('does not read "la" out of the middle of a word when looking for a Latin American marker', () => {
    const streams = [
      subtitleStream({ index: 4, tags: { language: 'spa', title: 'Balaclava' } }),
      subtitleStream({ index: 5, tags: { language: 'spa', title: 'Español LA' } }),
    ];

    const params = getSubtitleParams(streams, ['spa']);

    expect(mapArgCount(params)).toBe(1);
    expect(params).toContain('0:5');
    expect(params).toContain('title=Latino');
  });
});

// Defends REQ-2/REQ-6 (docs/spec/features/017-worker-gpu-strategy/spec.md):
// getVideoParams had no coverage at all before this feature. A fallback
// chain with the wrong operator order, a missing npl, or a lost bt709
// output tag is not an error — it emits a washed-out or crushed 1080p file
// that passes ffmpeg, passes mkvmerge, lands in the library and is marked
// COMPLETED. Asserting the exact -vf string, and that the -metadata:s:v:0
// title is identical across the true/false pair, is what would catch that
// drift — nothing else in the suite would.
describe('getVideoParams — 4K HDR tonemap branches (017-worker-gpu-strategy)', () => {
  const GPU_VF =
    'libplacebo=w=1920:h=1080:colorspace=bt709:color_primaries=bt709:color_trc=bt709:tonemapping=auto';
  const SOFTWARE_VF =
    'scale=1920:1080:force_original_aspect_ratio=decrease,' +
    'zscale=t=linear:npl=100,' +
    'format=gbrpf32le,' +
    'zscale=p=bt709,' +
    'tonemap=tonemap=hable:desat=0,' +
    'zscale=t=bt709:m=bt709:r=tv,' +
    'format=yuv420p10le';

  function vfOf(params: string[]): string | undefined {
    const i = params.indexOf('-vf');
    return i === -1 ? undefined : params[i + 1];
  }

  function titleOf(params: string[]): string | undefined {
    const i = params.indexOf('-metadata:s:v:0');
    return i === -1 ? undefined : params[i + 1];
  }

  it('emits the libplacebo chain for HDR10 when vulkanAvailable is true', () => {
    const stream = videoStream({ color_transfer: 'smpte2084' });
    const params = getVideoParams(stream, true, true);

    expect(vfOf(params)).toBe(GPU_VF);
  });

  it('emits the software zscale/tonemap chain for HDR10 when vulkanAvailable is false', () => {
    const stream = videoStream({ color_transfer: 'smpte2084' });
    const params = getVideoParams(stream, true, false);

    expect(vfOf(params)).toBe(SOFTWARE_VF);
  });

  it('emits the libplacebo chain for Dolby Vision when vulkanAvailable is true', () => {
    const stream = videoStream({
      side_data_list: [{ side_data_type: 'DOVI configuration record' }],
    });
    const params = getVideoParams(stream, true, true);

    expect(vfOf(params)).toBe(GPU_VF);
  });

  it('emits the software zscale/tonemap chain for Dolby Vision when vulkanAvailable is false', () => {
    const stream = videoStream({
      side_data_list: [{ side_data_type: 'DOVI configuration record' }],
    });
    const params = getVideoParams(stream, true, false);

    expect(vfOf(params)).toBe(SOFTWARE_VF);
  });

  it('keeps the DoVi -metadata:s:v:0 title byte-identical between the true/false pair (REQ-6)', () => {
    const stream = videoStream({
      side_data_list: [{ side_data_type: 'DOVI configuration record' }],
    });

    const withGpu = getVideoParams(stream, true, true);
    const withoutGpu = getVideoParams(stream, true, false);

    expect(titleOf(withGpu)).toBe(titleOf(withoutGpu));
    expect(titleOf(withGpu)).toBe('title=AV1 1080p (Tonemapped from 4K DoVi)');
  });

  it('keeps the HDR10 -metadata:s:v:0 title byte-identical between the true/false pair (REQ-6)', () => {
    const stream = videoStream({ color_transfer: 'smpte2084' });

    const withGpu = getVideoParams(stream, true, true);
    const withoutGpu = getVideoParams(stream, true, false);

    expect(titleOf(withGpu)).toBe(titleOf(withoutGpu));
    expect(titleOf(withGpu)).toBe('title=AV1 1080p (Tonemapped from 4K HDR10)');
  });
});
