// Defends src/ffmpeg/params.ts, the most rule-dense file in the worker and
// (per spec.md's Context & Goal) the one with the least test coverage: a
// wrong argument here produces a ProcessJob marked COMPLETED and a file with
// the wrong audio, the wrong subtitles, or the wrong language tags — no
// error in any log (Constitution, Article IX). Every case below reproduces
// one of the ways that used to happen silently: a language dropped because
// nobody normalized ISO-639-2/B vs /T, a commentary track kept because the
// blacklist wasn't applied before ranking, a missing original-language track
// papered over with a copy-all fallback, an image subtitle emitted as text,
// or (031-worker-language-variants) a regional Spanish preference applied
// when nobody asked for it, or ignored when somebody did.

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

const TRACK_TITLES: Record<string, string> = { eng: 'English', spa: 'Español' };

describe('getAudioParams', () => {
  it('emits exactly one -map per allowed language when a track exists for each', () => {
    const streams = [
      audioStream({ index: 1, tags: { language: 'jpn' } }),
      audioStream({ index: 2, tags: { language: 'spa' } }),
      audioStream({ index: 3, tags: { language: 'eng' } }),
    ];

    const params = getAudioParams(streams, ['jpn', 'spa', 'eng'], 'jpn', [], TRACK_TITLES);

    expect(mapArgCount(params)).toBe(3);
  });

  it('omits an allowed language with no matching track, without throwing', () => {
    const streams = [
      audioStream({ index: 1, tags: { language: 'jpn' } }),
      audioStream({ index: 2, tags: { language: 'eng' } }),
    ];

    const params = getAudioParams(streams, ['jpn', 'spa', 'eng'], 'jpn', [], TRACK_TITLES);

    expect(mapArgCount(params)).toBe(2);
    expect(params).toContain('0:1');
    expect(params).toContain('0:2');
  });

  it('never selects a track titled "Director\'s Commentary"', () => {
    const streams = [
      audioStream({ index: 1, tags: { language: 'eng', title: "Director's Commentary" } }),
      audioStream({ index: 2, tags: { language: 'eng', title: 'Original' } }),
    ];

    const params = getAudioParams(streams, ['eng'], 'eng', [], TRACK_TITLES);

    expect(mapArgCount(params)).toBe(1);
    expect(params).toContain('0:2');
    expect(params).not.toContain('0:1');
  });

  it('picks the truehd 5.1 track over an eac3 7.1 track in the same language — codec outranks channels', () => {
    const streams = [
      audioStream({ index: 1, codec_name: 'eac3', channels: 8, tags: { language: 'eng' } }),
      audioStream({ index: 2, codec_name: 'truehd', channels: 6, tags: { language: 'eng' } }),
    ];

    const params = getAudioParams(streams, ['eng'], 'eng', [], TRACK_TITLES);

    expect(mapArgCount(params)).toBe(1);
    expect(params).toContain('0:2');
  });

  // REQ-6: with no requested variant, the Latino title carries no weight at
  // all — quality decides alone, exactly as any other language. Rewritten
  // from the pre-031 case that asserted the opposite (an unconditional
  // Latino preference); the es-419-requested half below is what replaces it.
  it('picks the higher-channel Spanish track over the Latino-titled one when no variant was requested (REQ-6, AC-7 rules half)', () => {
    const streams = [
      audioStream({ index: 1, channels: 2, tags: { language: 'spa', title: 'Latino' } }),
      audioStream({ index: 2, channels: 6, tags: { language: 'spa', title: 'Spanish (Spain)' } }),
    ];

    const params = getAudioParams(streams, ['spa'], 'spa', [], TRACK_TITLES);

    expect(mapArgCount(params)).toBe(1);
    expect(params).toContain('0:2');
  });

  // AC-5: the bare "es" tag is how a Spanish-original title reaches the
  // worker with no variant chosen — TMDB's originalLanguage is "es", not a
  // region-tagged es-419/es-ES. requestedVariants must read it as "no
  // request", not as an unresolvable regional tag; only a tag carrying a
  // region subtag ("-") is ever a variant request (REQ-2, REQ-6).
  it('picks the 5.1 track over the Latino-titled one when only the bare "es" tag is present (AC-5)', () => {
    const streams = [
      audioStream({ index: 1, channels: 2, tags: { language: 'spa', title: 'Latino' } }),
      audioStream({ index: 2, channels: 6, tags: { language: 'spa', title: 'BTM' } }),
    ];

    const params = getAudioParams(streams, ['spa'], 'spa', ['es'], TRACK_TITLES);

    expect(mapArgCount(params)).toBe(1);
    expect(params).toContain('0:2');
    expect(params).not.toContain('0:1');
  });

  it('picks the Latino-titled Spanish track when es-419 is requested and it matches (AC-1)', () => {
    const streams = [
      audioStream({ index: 1, channels: 2, tags: { language: 'spa', title: 'Latino' } }),
      audioStream({ index: 2, channels: 6, tags: { language: 'spa', title: 'BTM' } }),
    ];

    const params = getAudioParams(streams, ['spa'], 'spa', ['es-419'], TRACK_TITLES);

    expect(mapArgCount(params)).toBe(1);
    expect(params).toContain('0:1');
    expect(params).not.toContain('0:2');
  });

  it('maps only the Latin American track when es-419 is requested against a Castellano-marked alternative (AC-2)', () => {
    const streams = [
      audioStream({ index: 1, channels: 2, tags: { language: 'spa', title: 'Latino' } }),
      audioStream({ index: 2, channels: 6, tags: { language: 'spa', title: 'Castellano' } }),
    ];

    const params = getAudioParams(streams, ['spa'], 'spa', ['es-419'], TRACK_TITLES);

    expect(mapArgCount(params)).toBe(1);
    expect(params).toContain('0:1');
    expect(params).not.toContain('0:2');
  });

  it('keeps every Spanish track when the requested es-ES variant matches nothing (REQ-5, AC-4)', () => {
    const streams = [
      audioStream({ index: 1, channels: 6, tags: { language: 'spa', title: 'BTM' } }),
      audioStream({ index: 2, channels: 2, tags: { language: 'spa', title: 'Latino' } }),
    ];

    const params = getAudioParams(streams, ['spa'], 'spa', ['es-ES'], TRACK_TITLES);

    expect(mapArgCount(params)).toBe(2);
    expect(params).toContain('0:1');
    expect(params).toContain('0:2');
  });

  it('maps one track per matched variant when both es-419 and es-ES are requested and present, each titled for its variant (AC-3)', () => {
    const streams = [
      audioStream({ index: 1, channels: 2, tags: { language: 'spa', title: 'Latino' } }),
      audioStream({ index: 2, channels: 2, tags: { language: 'spa', title: 'Castellano' } }),
    ];

    const params = getAudioParams(streams, ['spa'], 'spa', ['es-419', 'es-ES'], TRACK_TITLES);

    expect(mapArgCount(params)).toBe(2);
    expect(params).toContain('0:1');
    expect(params).toContain('0:2');
    expect(params).toContain('title=Latino Stereo (Opus)');
    expect(params).toContain('title=Español (España) Stereo (Opus)');
  });

  // AC-3b: REQ-12 is not a Spanish rule and not a variant rule — a language
  // the table does not cover falls back to its ISO-639-2 code, never to a
  // language-less title. Filling the table for jpn is a guess this feature
  // does not make (.claude/agents/ffmpeg.md § L2).
  it('falls back to the ISO-639-2 code for a language the title table does not cover (AC-3b)', () => {
    const streams = [audioStream({ index: 1, channels: 2, tags: { language: 'jpn' } })];

    const params = getAudioParams(streams, ['jpn'], 'jpn', [], {});

    expect(params).toContain('title=jpn Stereo (Opus)');
  });

  it('titles a Japanese track from the injected map (051 AC-3)', () => {
    const streams = [audioStream({ index: 1, channels: 2, tags: { language: 'jpn' } })];

    const params = getAudioParams(streams, ['jpn'], 'jpn', [], { jpn: '日本語' });

    expect(params).toContain('title=日本語 Stereo (Opus)');
  });

  it('resolves a track tagged "fra" against a map keyed by the /B form "fre" (051 AC-4)', () => {
    const streams = [audioStream({ index: 1, channels: 2, tags: { language: 'fra' } })];

    const params = getAudioParams(streams, ['fre'], 'fre', [], { fre: 'Français' });

    expect(params).toContain('title=Français Stereo (Opus)');
  });

  it('never lets a Latin-American-marked commentary track win a variant match (REQ-11 before REQ-4, AC-8)', () => {
    const streams = [
      audioStream({ index: 1, channels: 2, tags: { language: 'spa', title: 'Latino Commentary' } }),
      audioStream({ index: 2, channels: 6, tags: { language: 'spa', title: 'BTM' } }),
    ];

    const params = getAudioParams(streams, ['spa'], 'spa', ['es-419'], TRACK_TITLES);

    expect(mapArgCount(params)).toBe(1);
    expect(params).toContain('0:2');
    expect(params).not.toContain('0:1');
  });

  it('throws naming the original iso3 when no track in the original language survives filtering, variant narrowing notwithstanding (AC-6)', () => {
    const streams = [
      audioStream({ index: 1, tags: { language: 'spa', title: 'Latino' } }),
    ];

    expect(() => getAudioParams(streams, ['jpn', 'spa'], 'jpn', ['es-419'], TRACK_TITLES)).toThrow(/jpn/);
  });

  it('matches an allowed "fre" against a track tagged "fra" (ISO-639-2/T)', () => {
    const streams = [audioStream({ index: 1, tags: { language: 'fra' } })];

    const params = getAudioParams(streams, ['fre'], 'fre', [], TRACK_TITLES);

    expect(mapArgCount(params)).toBe(1);
    expect(params).toContain('0:1');
  });

  it('matches an allowed "fra" against a track tagged "fre" (the reverse pairing)', () => {
    const streams = [audioStream({ index: 1, tags: { language: 'fre' } })];

    const params = getAudioParams(streams, ['fra'], 'fra', [], TRACK_TITLES);

    expect(mapArgCount(params)).toBe(1);
    expect(params).toContain('0:1');
  });
});

describe('getSubtitleParams', () => {
  it('emits zero subtitle arguments when the only tracks are image subtitles (PGS)', () => {
    const streams = [
      subtitleStream({ index: 4, codec_name: 'hdmv_pgs_subtitle', tags: { language: 'eng' } }),
    ];

    const params = getSubtitleParams(streams, ['eng'], [], TRACK_TITLES);

    expect(params).toEqual([]);
  });

  it('drops a subtitle track whose BPS tag is 1', () => {
    const streams = [
      subtitleStream({ index: 4, tags: { language: 'eng', BPS: '1' } }),
    ];

    const params = getSubtitleParams(streams, ['eng'], [], TRACK_TITLES);

    expect(params).toEqual([]);
  });

  it('replaces an ALL-CAPS subtitle title with the language name', () => {
    const streams = [
      subtitleStream({ index: 4, tags: { language: 'eng', title: 'FORCED' } }),
    ];

    const params = getSubtitleParams(streams, ['eng'], [], TRACK_TITLES);

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

    const params = getSubtitleParams(streams, ['eng'], [], TRACK_TITLES);

    expect(mapArgCount(params)).toBe(1);
    expect(params).toContain('0:5');
  });

  it('keeps a hearing-impaired track when it is the only candidate in its language', () => {
    const streams = [
      subtitleStream({ index: 4, tags: { language: 'eng', title: 'SDH' }, disposition: { hearing_impaired: 1 } }),
    ];

    const params = getSubtitleParams(streams, ['eng'], [], TRACK_TITLES);

    expect(mapArgCount(params)).toBe(1);
    expect(params).toContain('0:4');
  });

  it('keeps every Spanish track when nothing marks any of them as regional', () => {
    const streams = [
      subtitleStream({ index: 4, tags: { language: 'spa', title: 'BTM' } }),
      subtitleStream({ index: 5, tags: { language: 'spa', title: 'BTM' } }),
    ];

    const params = getSubtitleParams(streams, ['spa'], [], TRACK_TITLES);

    expect(mapArgCount(params)).toBe(2);
    expect(params.filter((arg) => arg === 'title=Español')).toHaveLength(2);
  });

  // REQ-6/REQ-15: with no requested variant, nothing narrows a subtitle
  // language at all — both streams survive, undetected or not. Rewritten
  // from the pre-031 case that asserted an unconditional Latino preference;
  // the es-419-requested half below is what replaces it and keeps the
  // word-boundary assertion (the "LA" spelling that a substring match would
  // have missed).
  it('keeps every Spanish subtitle when no variant was requested, regardless of a Latin American marker (REQ-6)', () => {
    const streams = [
      subtitleStream({ index: 4, tags: { language: 'spa', title: 'Balaclava' } }),
      subtitleStream({ index: 5, tags: { language: 'spa', title: 'Español LA' } }),
    ];

    const params = getSubtitleParams(streams, ['spa'], [], TRACK_TITLES);

    expect(mapArgCount(params)).toBe(2);
    expect(params).toContain('0:4');
    expect(params).toContain('0:5');
  });

  it('does not read "la" out of the middle of a word when es-419 is requested', () => {
    const streams = [
      subtitleStream({ index: 4, tags: { language: 'spa', title: 'Balaclava' } }),
      subtitleStream({ index: 5, tags: { language: 'spa', title: 'Español LA' } }),
    ];

    const params = getSubtitleParams(streams, ['spa'], ['es-419'], TRACK_TITLES);

    expect(mapArgCount(params)).toBe(1);
    expect(params).toContain('0:5');
    expect(params).toContain('title=Latino');
  });

  it('maps only the Castellano SRT when es-ES is requested against a Latino alternative, titled Español (España) (AC-9)', () => {
    const streams = [
      subtitleStream({ index: 4, tags: { language: 'spa', title: 'Castellano' } }),
      subtitleStream({ index: 5, tags: { language: 'spa', title: 'Latino' } }),
    ];

    const params = getSubtitleParams(streams, ['spa'], ['es-ES'], TRACK_TITLES);

    expect(mapArgCount(params)).toBe(1);
    expect(params).toContain('0:4');
    expect(params).not.toContain('0:5');
    expect(params).toContain('title=Español (España)');
  });

  it('drops the SDH Latino track before variant narrowing, keeping the plain one (REQ-17, AC-10)', () => {
    const streams = [
      subtitleStream({ index: 4, tags: { language: 'spa', title: 'Latino SDH' } }),
      subtitleStream({ index: 5, tags: { language: 'spa', title: 'Latino' } }),
    ];

    const params = getSubtitleParams(streams, ['spa'], ['es-419'], TRACK_TITLES);

    expect(mapArgCount(params)).toBe(1);
    expect(params).toContain('0:5');
    expect(params).not.toContain('0:4');
  });

  it('keeps a Latino SDH track when it is the only Spanish subtitle in the file (REQ-17, AC-11)', () => {
    const streams = [
      subtitleStream({
        index: 4,
        tags: { language: 'spa', title: 'Latino SDH' },
        disposition: { hearing_impaired: 1 },
      }),
    ];

    const params = getSubtitleParams(streams, ['spa'], ['es-419'], TRACK_TITLES);

    expect(mapArgCount(params)).toBe(1);
    expect(params).toContain('0:4');
  });

  it('never lets variant narrowing drop the original-language subtitle (REQ-14, AC-12)', () => {
    const streams = [
      subtitleStream({ index: 4, tags: { language: 'eng', title: 'English' } }),
      subtitleStream({ index: 5, tags: { language: 'spa', title: 'BTM' } }),
    ];

    const params = getSubtitleParams(streams, ['eng', 'spa'], ['es-ES'], TRACK_TITLES);

    expect(mapArgCount(params)).toBe(2);
    expect(params).toContain('0:4');
    expect(params).toContain('0:5');
  });

  it('builds a valid, empty subtitle argument list when the file has no subtitle stream at all (REQ-13, AC-13)', () => {
    const params = getSubtitleParams([], ['eng'], [], TRACK_TITLES);

    expect(params).toEqual([]);
  });
});
