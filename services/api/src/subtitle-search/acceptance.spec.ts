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
  mediaDurationMs: 100_000,
  lastChapterStartMs: null,
  lastCueEndMs: 100_000,
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

  it('tolerates a ratio within 0.0005 of 1', () => {
    expect(accept(good({ framerateRatio: 1.0004 }), thresholds)).toBeNull();
    expect(accept(good({ framerateRatio: 1.001 }), thresholds)).toBe(
      'error.subtitleSearch.framerate_mismatch',
    );
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

  // Spec 103, REQ-10
  describe('measured thresholds', () => {
    const SUB_GOOD = [
      630129, 633427, 629973, 604068, 373920, 364547, 382513, 438001,
    ];
    const AUDIO_GOOD = [247976, 217484, 202612, 211884];

    it('pins the constants to the measured separation points', () => {
      expect(SUBTITLE_REFERENCE_MIN_SCORE).toBe(100_000);
      expect(AUDIO_REFERENCE_MIN_SCORE).toBe(50_000);
    });

    it.each(SUB_GOOD)(
      'accepts the measured good subtitle score %d',
      (score) => {
        expect(accept(good({ score }))).toBeNull();
      },
    );

    it.each(AUDIO_GOOD)('accepts the measured good audio score %d', (score) => {
      expect(accept(good({ reference: 'AUDIO', score }))).toBeNull();
    });

    it('rejects the measured bad subtitle score', () => {
      expect(accept(good({ score: 28446 }))).toBe(
        'error.subtitleSearch.low_score',
      );
    });

    it.each([-1051, -274712.888, -249509.16])(
      'rejects the measured bad audio score %d',
      (score) => {
        expect(accept(good({ reference: 'AUDIO', score }))).toBe(
          'error.subtitleSearch.low_score',
        );
      },
    );

    it('rejects a PAL framerate-mismatched audio measurement on the ratio first', () => {
      expect(
        accept(
          good({
            reference: 'AUDIO',
            score: -274712.888,
            framerateRatio: 1.0427,
          }),
        ),
      ).toBe('error.subtitleSearch.framerate_mismatch');
    });

    // The halves of a 2h file score above threshold yet cover only ~half of it.
    it.each([
      [307289, 48],
      [320324, 50],
    ])('rejects a high-scoring half-file (%d) as incomplete', (score, pct) => {
      const duration = 7_200_000;
      const m = good({
        score,
        offsetMs: 0,
        mediaDurationMs: duration,
        lastCueEndMs: (duration * pct) / 100,
      });
      expect(score).toBeGreaterThan(SUBTITLE_REFERENCE_MIN_SCORE);
      expect(accept(m)).toBe('error.subtitleSearch.incomplete');
    });
  });

  it('rejects a NaN score', () => {
    expect(accept(good({ score: NaN }), thresholds)).toBe(
      'error.subtitleSearch.low_score',
    );
  });

  // Spec 103, REQ-10
  describe('coverage', () => {
    // offset is -2000 in good(); cue end is chosen so end + offset is the target.
    const covering = (target: number, over: Partial<SyncMeasurement> = {}) =>
      good({ lastCueEndMs: target + 2000, ...over });

    it('without chapters rejects 0.48 and 0.60 of the duration and accepts 0.61', () => {
      const key = 'error.subtitleSearch.incomplete';
      expect(accept(covering(48_000), thresholds)).toBe(key);
      expect(accept(covering(60_000), thresholds)).toBe(key);
      expect(accept(covering(61_000), thresholds)).toBeNull();
    });

    it('against a qualifying last chapter rejects 0.85 and accepts 0.86', () => {
      const key = 'error.subtitleSearch.incomplete';
      const chapter = { lastChapterStartMs: 90_000 };
      expect(accept(covering(76_500, chapter), thresholds)).toBe(key);
      expect(accept(covering(77_400, chapter), thresholds)).toBeNull();
    });

    it('ignores a last chapter at 70 % of the duration', () => {
      const chapter = { lastChapterStartMs: 70_000 };
      expect(accept(covering(61_000, chapter), thresholds)).toBeNull();
      expect(accept(covering(60_000, chapter), thresholds)).toBe(
        'error.subtitleSearch.incomplete',
      );
    });

    it('rejects a file whose last cue could not be read', () => {
      expect(accept(good({ lastCueEndMs: null }), thresholds)).toBe(
        'error.subtitleSearch.incomplete',
      );
    });

    it('checks coverage after the offset and before the score', () => {
      const bad = good({ lastCueEndMs: 1000, score: 0 });
      expect(accept(bad, thresholds)).toBe('error.subtitleSearch.incomplete');
      expect(accept({ ...bad, offsetMs: 700_000 }, thresholds)).toBe(
        'error.subtitleSearch.offset_too_large',
      );
    });
  });
});
