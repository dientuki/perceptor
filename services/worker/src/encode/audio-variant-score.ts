import type { AudioVariantDetector } from './variant-detectors';
import { dedupeLines, score } from './variant-score';

export const DUPLICATE_THRESHOLD = 0.75;
export const DECISION_MARGIN = 6;

export interface VariantTranscript {
  index: number;
  text: string;
}

export type AudioVariantVerdict =
  | { kind: 'duplicate'; similarity: number }
  | { kind: 'decided'; tags: Record<number, string>; scores: [number, number]; similarity: number }
  | { kind: 'undecided'; scores: [number, number]; similarity: number };

function words(text: string): string[] {
  return dedupeLines(text).match(/[a-záéíóúüñ]+/g) ?? [];
}

function longestMatch(a: string[], b: string[], alo: number, ahi: number, blo: number, bhi: number) {
  let bestI = alo;
  let bestJ = blo;
  let bestSize = 0;
  let previous = new Map<number, number>();
  for (let i = alo; i < ahi; i++) {
    const current = new Map<number, number>();
    for (let j = blo; j < bhi; j++) {
      if (a[i] !== b[j]) continue;
      const size = (previous.get(j - 1) ?? 0) + 1;
      current.set(j, size);
      if (size > bestSize) {
        bestI = i - size + 1;
        bestJ = j - size + 1;
        bestSize = size;
      }
    }
    previous = current;
  }
  return { i: bestI, j: bestJ, size: bestSize };
}

function matchingTotal(a: string[], b: string[]): number {
  let total = 0;
  const pending: [number, number, number, number][] = [[0, a.length, 0, b.length]];
  while (pending.length > 0) {
    const [alo, ahi, blo, bhi] = pending.pop()!;
    const { i, j, size } = longestMatch(a, b, alo, ahi, blo, bhi);
    if (size === 0) continue;
    total += size;
    if (alo < i && blo < j) pending.push([alo, i, blo, j]);
    if (i + size < ahi && j + size < bhi) pending.push([i + size, ahi, j + size, bhi]);
  }
  return total;
}

export function similarity(a: string, b: string): number {
  const wordsA = words(a);
  const wordsB = words(b);
  const length = wordsA.length + wordsB.length;
  if (length === 0) return 1;
  return (2 * matchingTotal(wordsA, wordsB)) / length;
}

export function decide(
  pair: [VariantTranscript, VariantTranscript],
  detector: AudioVariantDetector,
  margin: number = DECISION_MARGIN,
  duplicateThreshold: number = DUPLICATE_THRESHOLD,
): AudioVariantVerdict {
  const [first, second] = pair;
  const sim = similarity(first.text, second.text);
  const scores: [number, number] = [score(first.text, detector.markers), score(second.text, detector.markers)];
  if (sim >= duplicateThreshold) return { kind: 'duplicate', similarity: sim };
  if (Math.abs(scores[0] - scores[1]) < margin) return { kind: 'undecided', scores, similarity: sim };
  const [aIndex, bIndex] = scores[0] > scores[1] ? [first.index, second.index] : [second.index, first.index];
  return {
    kind: 'decided',
    tags: { [aIndex]: detector.tags[0], [bIndex]: detector.tags[1] },
    scores,
    similarity: sim,
  };
}
