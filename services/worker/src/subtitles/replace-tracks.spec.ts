// Defends against a replace that deletes the wrong track: a forced track, an
// image track or another language dropped from the library file in the same
// remux that is then renamed over the only copy, with no error anywhere.

import { describe, expect, it } from 'vitest';
import { tracksToDrop, type ProbedSubtitleStream } from './replace-tracks';

const sub = (
  index: number,
  language: string | undefined,
  over: Partial<ProbedSubtitleStream> = {},
): ProbedSubtitleStream => ({
  index,
  codec_type: 'subtitle',
  codec_name: 'subrip',
  tags: language === undefined ? {} : { language },
  disposition: { default: 0, forced: 0 },
  ...over,
});

describe('tracksToDrop', () => {
  it('drops every non-forced text track of a listed language', () => {
    const streams = [
      { index: 0, codec_type: 'video', codec_name: 'av1' },
      sub(1, 'spa'),
      sub(2, 'spa', { codec_name: 'ass' }),
      sub(3, 'eng'),
    ];
    expect(tracksToDrop(streams, ['spa'])).toEqual([1, 2]);
  });

  it('keeps a forced track of the listed language', () => {
    const streams = [sub(1, 'spa'), sub(2, 'spa', { disposition: { forced: 1 } })];
    expect(tracksToDrop(streams, ['spa'])).toEqual([1]);
  });

  it('keeps image tracks of the listed language', () => {
    const streams = [
      sub(1, 'spa', { codec_name: 'hdmv_pgs_subtitle' }),
      sub(2, 'spa', { codec_name: 'dvd_subtitle' }),
      sub(3, 'spa', { codec_name: 'dvb_subtitle' }),
    ];
    expect(tracksToDrop(streams, ['spa'])).toEqual([]);
  });

  it('keeps a subtitle with an unknown codec', () => {
    expect(tracksToDrop([sub(1, 'spa', { codec_name: 'mystery' })], ['spa'])).toEqual([]);
  });

  it('drops the other text codecs too', () => {
    const streams = ['webvtt', 'mov_text', 'ssa', 'text'].map((codec, i) =>
      sub(i + 1, 'spa', { codec_name: codec }),
    );
    expect(tracksToDrop(streams, ['spa'])).toEqual([1, 2, 3, 4]);
  });

  it('never drops audio or video even when tagged with the language', () => {
    const streams = [
      { index: 0, codec_type: 'audio', codec_name: 'opus', tags: { language: 'spa' } },
    ];
    expect(tracksToDrop(streams, ['spa'])).toEqual([]);
  });

  it('drops nothing for an empty list', () => {
    expect(tracksToDrop([sub(1, 'spa')], [])).toEqual([]);
  });

  it('drops nothing when the track has no language', () => {
    expect(tracksToDrop([sub(1, undefined), sub(2, '')], ['spa'])).toEqual([]);
  });

  it('drops nothing for a language that is not in the file', () => {
    expect(tracksToDrop([sub(1, 'eng')], ['fra'])).toEqual([]);
  });

  it('matches case-insensitively and across ISO 639-2 B and T forms', () => {
    const streams = [sub(1, 'SPA'), sub(2, 'fre'), sub(3, 'fra')];
    expect(tracksToDrop(streams, ['Spa', 'fra'])).toEqual([1, 2, 3]);
  });
});
