// Absolute subtitle variant scoring fails silently: a threshold set on the wrong side of the corpus,
// or a rate computed over too few words, would tag a Latin subtitle as Castilian (or the reverse) and
// the wrong variant would be kept, titled or rejected with nothing logged. These tests build texts
// from representative sentences at the rates measured on the 13 labelled OpenSubtitles files
// (worker/plan.md, step 1): Spain 14.5 to 15.8 per 1000 words, Latin -2.0 to 1.2, one ambiguous Latin
// file at 5.6 that must never read as Spain. Below the minimum word count the answer is undecided.

import { describe, expect, it } from 'vitest';

import { findAudioVariantDetector } from './variant-detectors';
import {
  decideAbsolute,
  DOWNLOAD_LATIN_MAX_RATE,
  DOWNLOAD_SPAIN_MIN_RATE,
  MIN_WORDS_FOR_RATE,
  scoreRate,
  SUBTITLE_DECISION_MARGIN,
} from './variant-score';

const spanish = findAudioVariantDetector('spa')!;

function neutral(index: number): string {
  return `Línea ${index} de diálogo sin marcas ni variantes regionales alguna en esta frase larga`;
}

function build(words: number, markerLine: string, markerCount: number): string {
  const lines: string[] = [];
  for (let i = 0; i < markerCount; i += 1) lines.push(`${markerLine} ${i}`);
  let total = lines.join(' ').split(/\s+/).length;
  for (let i = 0; total < words; i += 1) {
    const line = neutral(i);
    lines.push(line);
    total += line.split(/\s+/).length;
  }
  return lines.join('\n');
}

describe('thresholds', () => {
  it('leaves room on both sides of the corpus', () => {
    expect(DOWNLOAD_SPAIN_MIN_RATE).toBeLessThan(14.5);
    expect(DOWNLOAD_SPAIN_MIN_RATE).toBeGreaterThan(5.6);
    expect(DOWNLOAD_LATIN_MAX_RATE).toBeGreaterThan(1.2);
    expect(DOWNLOAD_LATIN_MAX_RATE).toBeLessThan(5.6);
    expect(MIN_WORDS_FOR_RATE).toBeLessThan(3850);
    expect(SUBTITLE_DECISION_MARGIN).toBeGreaterThan(0);
  });
});

describe('decideAbsolute on corpus-shaped texts', () => {
  const spainLine = 'Ya he visto el ordenador';
  const latinLine = 'Ustedes manejan la computadora';
  const cases: Array<[string, number, string, number, string | null]> = [
    ['Spain, Interstellar-like (about 15.7)', 10800, spainLine, 85, 'es-ES'],
    ['Spain, lowest labelled (about 14.5)', 11500, spainLine, 83, 'es-ES'],
    ['Latin, highest labelled (about 1.2)', 11200, 'Vosotros dijeron', 4, 'es-419'],
    ['Latin, negative rate (about -2)', 8500, latinLine, 3, 'es-419'],
    ['Latin, JP3-like short file (about 0.8)', 3850, 'Vosotros dijeron', 1, 'es-419'],
    ['ambiguous Latin (about 5.6) is undecided, never Spain', 8500, 'Joder ya he visto', 12, null],
  ];

  it.each(cases)('%s', (_name, words, line, count, expected) => {
    const text = build(words, line, count);
    const result = decideAbsolute(text, spanish);
    expect(result).toBe(expected);
    expect(result).not.toBe(expected === 'es-419' ? 'es-ES' : 'es-419');
  });

  it('never decides the ambiguous Latin rate as Spain', () => {
    const text = build(8538, 'Joder ya he visto', 12);
    const rate = scoreRate(text, spanish.markers)!;
    expect(rate).toBeGreaterThan(DOWNLOAD_LATIN_MAX_RATE);
    expect(rate).toBeLessThan(DOWNLOAD_SPAIN_MIN_RATE);
    expect(decideAbsolute(text, spanish)).toBeNull();
  });
});

describe('minimum words and empty text', () => {
  it('gives null below the minimum even when every line is a Spain marker', () => {
    const text = Array.from({ length: 40 }, (_v, i) => `Vosotros habéis venido ${i}`).join('\n');
    expect(scoreRate(text, spanish.markers)).toBeNull();
    expect(decideAbsolute(text, spanish)).toBeNull();
  });

  it('gives null for a forced-track-size text', () => {
    expect(decideAbsolute(build(300, 'Ordenador', 5), spanish)).toBeNull();
  });

  it('gives null for a zero-byte text', () => {
    expect(scoreRate('', spanish.markers)).toBeNull();
    expect(decideAbsolute('', spanish)).toBeNull();
  });

  it('counts words of the deduplicated text, so repeated lines cannot reach the minimum', () => {
    const text = Array.from({ length: 500 }, () => 'Vosotros habéis venido a por el ordenador').join('\n');
    expect(decideAbsolute(text, spanish)).toBeNull();
  });
});

describe('scoreRate', () => {
  it('is the score per 1000 words', () => {
    const text = build(2000, 'Vosotros dijeron', 4);
    const rate = scoreRate(text, spanish.markers)!;
    expect(rate).toBeGreaterThan(5);
    expect(rate).toBeLessThan(7);
  });
});
