// normalizeSubtitleFormats is the whole degradation path for an untrusted
// payload field (worker/plan.md's Contract obligations). One that turned []
// into the default would silently re-enable subtitles an administrator
// disabled; one that threw would fail every encode against an api that sends
// nothing. Absent or malformed input must degrade to the default and log, an
// empty array must stay empty, and nothing may throw.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SUBTITLE_FORMATS, normalizeSubtitleFormats } from './subtitle-formats';

describe('normalizeSubtitleFormats', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it.each([undefined, null, 'srt', 42, {}])('returns the default and warns for non-array %j', (raw) => {
    expect(normalizeSubtitleFormats(raw)).toEqual([...DEFAULT_SUBTITLE_FORMATS]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('returns a fresh array, not the shared default', () => {
    const result = normalizeSubtitleFormats(undefined);
    result.push('pgs');
    expect(DEFAULT_SUBTITLE_FORMATS).not.toContain('pgs');
  });

  it('keeps an empty array empty and does not warn', () => {
    expect(normalizeSubtitleFormats([])).toEqual([]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('keeps known ids in order without warning', () => {
    expect(normalizeSubtitleFormats(['pgs', 'srt', 'vobsub', 'dvb'])).toEqual(['pgs', 'srt', 'vobsub', 'dvb']);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('drops unknown ids, keeps known ones and warns once', () => {
    expect(normalizeSubtitleFormats(['srt', 'eia_608', 'bogus', 'pgs', 7])).toEqual(['srt', 'pgs']);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('collapses duplicates', () => {
    expect(normalizeSubtitleFormats(['srt', 'srt', 'ass', 'srt'])).toEqual(['srt', 'ass']);
  });

  it('returns [] when every id is unknown, never the default', () => {
    expect(normalizeSubtitleFormats(['bogus'])).toEqual([]);
  });
});
