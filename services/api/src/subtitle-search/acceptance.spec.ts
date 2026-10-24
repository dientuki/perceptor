// The acceptance rule is the only thing between a mistimed subtitle and the
// library file. A ratio check, an offset bound or a score threshold that
// quietly stops applying embeds a wrong track and nothing errors: the search
// still reads EMBEDDED. Each case below fails when its rule is removed.

import {
  accept,
  AUDIO_REFERENCE_MIN_SCORE,
  SUBTITLE_REFERENCE_MIN_SCORE,
  SyncMeasurement,
} from './acceptance';

const thresholds = { subtitle: 50, audio: 30 };

const good = (over: Partial<SyncMeasurement> = {}): SyncMeasurement => ({
  offsetMs: -2000,
  framerateRatio: 1,
  reference: 'SUBTITLE',
  score: 100,
  ...over,
});

describe('accept', () => {
  it('accepts a measurement that meets every rule', () => {
    expect(accept(good(), thresholds)).toBeNull();
  });

  it('rejects a framerate ratio other than 1', () => {
    expect(accept(good({ framerateRatio: 1.0427 }), thresholds)).toBe(
      'error.subtitleSearch.framerate_mismatch',
    );
  });

  it('tolerates a ratio within 0.001 of 1', () => {
    expect(accept(good({ framerateRatio: 1.0005 }), thresholds)).toBeNull();
  });

  it('rejects an offset over the bound, in either direction', () => {
    expect(accept(good({ offsetMs: 600_001 }), thresholds)).toBe(
      'error.subtitleSearch.offset_too_large',
    );
    expect(accept(good({ offsetMs: -600_001 }), thresholds)).toBe(
      'error.subtitleSearch.offset_too_large',
    );
    expect(accept(good({ offsetMs: 600_000 }), thresholds)).toBeNull();
  });

  it('rejects a score under the subtitle threshold and accepts one at it', () => {
    expect(accept(good({ score: 49 }), thresholds)).toBe(
      'error.subtitleSearch.low_score',
    );
    expect(accept(good({ score: 50 }), thresholds)).toBeNull();
  });

  it('uses the audio threshold for an audio reference', () => {
    const audio = good({ reference: 'AUDIO', score: 40 });
    expect(accept(audio, thresholds)).toBeNull();
    expect(accept({ ...audio, score: 29 }, thresholds)).toBe(
      'error.subtitleSearch.low_score',
    );
  });

  it('checks the ratio before the offset and the offset before the score', () => {
    const bad = good({ framerateRatio: 1.04, offsetMs: 700_000, score: 0 });
    expect(accept(bad, thresholds)).toBe(
      'error.subtitleSearch.framerate_mismatch',
    );
    expect(accept({ ...bad, framerateRatio: 1 }, thresholds)).toBe(
      'error.subtitleSearch.offset_too_large',
    );
  });

  // Until the measurement task sets real values the default constants must
  // reject everything, never accept everything.
  it('rejects even a perfect score with the placeholder thresholds', () => {
    expect(SUBTITLE_REFERENCE_MIN_SCORE).toBe(Number.POSITIVE_INFINITY);
    expect(AUDIO_REFERENCE_MIN_SCORE).toBe(Number.POSITIVE_INFINITY);
    expect(accept(good({ score: 1e9 }))).toBe('error.subtitleSearch.low_score');
    expect(accept(good({ reference: 'AUDIO', score: 1e9 }))).toBe(
      'error.subtitleSearch.low_score',
    );
  });

  it('rejects a NaN score', () => {
    expect(accept(good({ score: NaN }), thresholds)).toBe(
      'error.subtitleSearch.low_score',
    );
  });
});
