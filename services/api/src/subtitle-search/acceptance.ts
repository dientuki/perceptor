// Spec 103, REQ-10
export const SUBTITLE_REFERENCE_MIN_SCORE = 100_000;

// Spec 103, REQ-10
export const AUDIO_REFERENCE_MIN_SCORE = 50_000;

export const MAX_ABS_OFFSET_MS = 600_000;

const FRAMERATE_TOLERANCE = 0.0005;

// Spec 103, REQ-10
export const CHAPTER_COVERAGE = 0.85;
export const DURATION_COVERAGE = 0.6;
export const CHAPTER_GATE = 0.8;

export type SyncMeasurement = {
  offsetMs: number;
  framerateRatio: number;
  reference: 'SUBTITLE' | 'AUDIO';
  score: number;
  mediaDurationMs: number;
  lastChapterStartMs: number | null;
  lastCueEndMs: number | null;
};

export type RejectionKey =
  | 'error.subtitleSearch.framerate_mismatch'
  | 'error.subtitleSearch.offset_too_large'
  | 'error.subtitleSearch.incomplete'
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

  if (!coversMedia(measurement)) {
    return 'error.subtitleSearch.incomplete';
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

// Spec 103, REQ-10
function coversMedia(m: SyncMeasurement): boolean {
  if (m.lastCueEndMs === null) return false;
  const end = m.lastCueEndMs + m.offsetMs;
  if (
    m.lastChapterStartMs !== null &&
    m.lastChapterStartMs > CHAPTER_GATE * m.mediaDurationMs
  ) {
    return end > CHAPTER_COVERAGE * m.lastChapterStartMs;
  }
  return end > DURATION_COVERAGE * m.mediaDurationMs;
}
