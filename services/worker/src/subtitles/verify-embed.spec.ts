// Defends against a remux that mkvmerge calls a success but that lost, reordered
// or retagged a track: the verified result is renamed over the only copy of a
// film, so a wrong acceptance destroys the original with no error anywhere.

import { describe, expect, it } from 'vitest';
import { verifyEmbed, type VerifyMetadata, type VerifyStream } from './verify-embed';

const video: VerifyStream = { codec_type: 'video', codec_name: 'av1' };
const audio = (language: string): VerifyStream => ({
  codec_type: 'audio',
  codec_name: 'opus',
  tags: { language },
});
const sub = (language: string, extra: VerifyStream['disposition'] = {}): VerifyStream => ({
  codec_type: 'subtitle',
  codec_name: 'subrip',
  tags: { language },
  disposition: { default: 0, forced: 0, ...extra },
});

const meta = (streams: VerifyStream[], duration = '100.000'): VerifyMetadata => ({
  streams,
  format: { duration },
});

const original = meta([video, audio('eng'), sub('eng', { default: 1 })]);
const requested = [{ languageIso3: 'spa', isDefault: false, isForced: false }];

describe('verifyEmbed', () => {
  it('accepts the original streams followed by exactly the requested ones', () => {
    const result = meta([video, audio('eng'), sub('eng', { default: 1 }), sub('spa')]);
    expect(verifyEmbed(original, result, requested)).toEqual({ ok: true });
  });

  it('rejects a missing original track even when the stream count still matches', () => {
    const result = meta([video, sub('eng', { default: 1 }), sub('spa'), sub('spa')]);
    expect(verifyEmbed(original, result, requested).ok).toBe(false);
  });

  it('rejects swapped original tracks at equal counts', () => {
    const result = meta([video, sub('eng', { default: 1 }), audio('eng'), sub('spa')]);
    expect(verifyEmbed(original, result, requested).ok).toBe(false);
  });

  it('rejects a result with an extra trailing stream', () => {
    const result = meta([video, audio('eng'), sub('eng', { default: 1 }), sub('spa'), sub('fre')]);
    expect(verifyEmbed(original, result, requested).ok).toBe(false);
  });

  it('rejects a new track with the wrong language or forced flag', () => {
    const wrongLang = meta([video, audio('eng'), sub('eng', { default: 1 }), sub('fre')]);
    expect(verifyEmbed(original, wrongLang, requested).ok).toBe(false);
    const wrongForced = meta([video, audio('eng'), sub('eng', { default: 1 }), sub('spa', { forced: 1 })]);
    expect(verifyEmbed(original, wrongForced, requested).ok).toBe(false);
  });

  it('rejects a 2 s duration drift and accepts a 0.5 s one', () => {
    const streams = [video, audio('eng'), sub('eng', { default: 1 }), sub('spa')];
    expect(verifyEmbed(original, meta(streams, '102.000'), requested).ok).toBe(false);
    expect(verifyEmbed(original, meta(streams, '100.500'), requested)).toEqual({ ok: true });
  });

  it('rejects a missing duration instead of treating NaN as no drift', () => {
    const streams = [video, audio('eng'), sub('eng', { default: 1 }), sub('spa')];
    expect(verifyEmbed(original, { streams }, requested).ok).toBe(false);
  });

  it('rejects two default subtitles when a default was requested', () => {
    const asked = [{ languageIso3: 'spa', isDefault: true, isForced: false }];
    const result = meta([video, audio('eng'), sub('eng', { default: 1 }), sub('spa', { default: 1 })]);
    expect(verifyEmbed(original, result, asked).ok).toBe(false);
  });

  it('accepts exactly the requested track as the only default', () => {
    const asked = [{ languageIso3: 'spa', isDefault: true, isForced: false }];
    const result = meta([video, audio('eng'), sub('eng'), sub('spa', { default: 1 })]);
    expect(verifyEmbed(original, result, asked)).toEqual({ ok: true });
  });

  it('accepts ger against deu', () => {
    const base = meta([video, audio('ger')]);
    const result = meta([video, audio('deu'), sub('ger')]);
    expect(verifyEmbed(base, result, [{ languageIso3: 'deu', isDefault: false, isForced: false }])).toEqual({
      ok: true,
    });
  });
});
