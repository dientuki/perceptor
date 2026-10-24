// Spec 103, REQ-10
export const SUBTITLE_REFERENCE_MIN_SCORE = Number.POSITIVE_INFINITY;

// Spec 103, REQ-10
export const AUDIO_REFERENCE_MIN_SCORE = Number.POSITIVE_INFINITY;

export const MAX_ABS_OFFSET_MS = 600_000;

const FRAMERATE_TOLERANCE = 0.001;

export type SyncMeasurement = {
  offsetMs: number;
  framerateRatio: number;
  reference: 'SUBTITLE' | 'AUDIO';
  score: number;
};

export type RejectionKey =
  | 'error.subtitleSearch.framerate_mismatch'
  | 'error.subtitleSearch.offset_too_large'
  | 'error.subtitleSearch.low_score';

export type Thresholds = { subtitle: number; audio: number };

// Spec 103, REQ-10
export function accept(
  measurement: SyncMeasurement,
  thresholds: Thresholds = {
    subtitle: SUBTITLE_REFERENCE_MIN_SCORE,
    audio: AUDIO_REFERENCE_MIN_SCORE,
  },
): RejectionKey | null {
  if (Math.abs(measurement.framerateRatio - 1) > FRAMERATE_TOLERANCE) {
    return 'error.subtitleSearch.framerate_mismatch';
  }

  if (Math.abs(measurement.offsetMs) > MAX_ABS_OFFSET_MS) {
    return 'error.subtitleSearch.offset_too_large';
  }

  const threshold =
    measurement.reference === 'SUBTITLE'
      ? thresholds.subtitle
      : thresholds.audio;

  if (!(measurement.score >= threshold)) {
    return 'error.subtitleSearch.low_score';
  }

  return null;
}
