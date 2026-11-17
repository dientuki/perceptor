import type { AudioVariantDetector, AudioVariantMarkers } from './variant-detectors';

const STRONG_A_WEIGHT = 3;
const WEAK_A_WEIGHT = 1;
const PRESENT_PERFECT_WEIGHT = 1;
const B_WEIGHT = -2;
const WEAK_B_WEIGHT = -1;

// Spec 118, REQ-6 REQ-14
export const SUBTITLE_DECISION_MARGIN = 10;
export const DOWNLOAD_SPAIN_MIN_RATE = 10;
export const DOWNLOAD_LATIN_MAX_RATE = 3;
export const MIN_WORDS_FOR_RATE = 1000;

export function dedupeLines(text: string): string {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim().toLowerCase();
    if (line && !seen.has(line)) {
      seen.add(line);
      kept.push(line);
    }
  }
  return kept.join(' \n');
}

// Spec 118, REQ-4b
function dedupeLinesCased(text: string): string {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const key = line.toLowerCase();
    if (line && !seen.has(key)) {
      seen.add(key);
      kept.push(line);
    }
  }
  return kept.join(' \n');
}

function count(text: string, patterns: RegExp[]): number {
  let total = 0;
  for (const pattern of patterns) total += text.match(new RegExp(pattern.source, pattern.flags))?.length ?? 0;
  return total;
}

export function score(text: string, markers: AudioVariantMarkers): number {
  const deduped = dedupeLines(text);
  const cased = dedupeLinesCased(text);
  return (
    STRONG_A_WEIGHT * count(deduped, markers.strongA) +
    WEAK_A_WEIGHT * count(deduped, markers.weakA) +
    PRESENT_PERFECT_WEIGHT * count(deduped, markers.presentPerfect) +
    B_WEIGHT * count(deduped, markers.b) +
    STRONG_A_WEIGHT * count(cased, markers.casedStrongA ?? []) +
    WEAK_B_WEIGHT * count(deduped, markers.weakB ?? [])
  );
}

// Spec 118, REQ-14
export function scoreRate(text: string, markers: AudioVariantMarkers): number | null {
  const words = dedupeLines(text).split(/\s+/).filter(Boolean).length;
  if (words < MIN_WORDS_FOR_RATE) return null;
  return (score(text, markers) / words) * 1000;
}

// Spec 118, REQ-6b REQ-14
export function decideAbsolute(text: string, detector: AudioVariantDetector): string | null {
  const rate = scoreRate(text, detector.markers);
  if (rate === null) return null;
  if (rate >= DOWNLOAD_SPAIN_MIN_RATE) return detector.tags[0];
  if (rate <= DOWNLOAD_LATIN_MAX_RATE) return detector.tags[1];
  return null;
}
