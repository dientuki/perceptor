// Audio variant scoring fails silently: a wrong marker weight, a substring match (`os` inside `osos`)
// or repeated hallucinated lines inflating one stream would tag the wrong track as Castilian, and the
// encode would keep and label the wrong dub with nothing logged as an error. These tests run the real
// scorer over scrambled-but-marker-preserving transcripts of the three calibration films
// (fixtures/audio-variant): It Chapter Two and Interstellar decide stream 2 as es-ES, Jurassic Park III
// carries the same dub twice and must read as a duplicate, never as a decision.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AUDIO_VARIANT_DETECTORS, findAudioVariantDetector } from './audio-variant-detectors';
import { dedupeLines, decide, score, similarity } from './audio-variant-score';

const FIXTURES = join(__dirname, '..', '..', 'fixtures', 'audio-variant');
const manifest = JSON.parse(readFileSync(join(FIXTURES, 'manifest.json'), 'utf8')) as {
  films: Record<string, { tracks: number[]; expect: { kind: string; tags?: Record<string, string> } }>;
};
const spanish = findAudioVariantDetector('spa')!;

function transcript(film: string, index: number): string {
  return readFileSync(join(FIXTURES, film, `${index}.txt`), 'utf8');
}

function pair(film: string) {
  const [a, b] = manifest.films[film].tracks;
  return [
    { index: a, text: transcript(film, a) },
    { index: b, text: transcript(film, b) },
  ] as [{ index: number; text: string }, { index: number; text: string }];
}

describe('registry', () => {
  it('has one Spanish entry keyed by iso3', () => {
    expect(AUDIO_VARIANT_DETECTORS.map((entry) => entry.iso3)).toEqual(['spa']);
    expect(spanish.tags).toEqual(['es-ES', 'es-419']);
  });
});

describe('fixture films', () => {
  it.each(Object.keys(manifest.films))('%s decides the manifest verdict', (film) => {
    const verdict = decide(pair(film), spanish);
    expect(verdict.kind).toBe(manifest.films[film].expect.kind);
    if (verdict.kind === 'decided') expect(verdict.tags).toEqual(manifest.films[film].expect.tags);
  });

  it('It Chapter Two scores 49 against 0 as the prototype scorer does on the originals', () => {
    const verdict = decide(pair('it'), spanish);
    expect(verdict.kind === 'decided' && verdict.scores).toEqual([49, 0]);
  });

  it('Interstellar scores 31 against 0', () => {
    const verdict = decide(pair('interstellar'), spanish);
    expect(verdict.kind === 'decided' && verdict.scores).toEqual([31, 0]);
  });

  it('Jurassic Park III reads as the same dub twice', () => {
    expect(similarity(transcript('jp3', 2), transcript('jp3', 3))).toBeGreaterThanOrEqual(0.75);
    expect(similarity(transcript('jp3', 2), transcript('jp3', 3))).toBeLessThan(1);
  });

  it('It Chapter Two and Interstellar pairs are never duplicates', () => {
    expect(similarity(transcript('it', 2), transcript('it', 3))).toBeLessThan(0.5);
    expect(similarity(transcript('interstellar', 2), transcript('interstellar', 3))).toBeLessThan(0.5);
  });
});

describe('score', () => {
  it('weighs strong A x3, weak A x1, present perfect x1 and B x-2', () => {
    expect(score('vale\ncoche\nhe comido\nustedes', spanish.markers)).toBe(3 + 1 + 1 - 2);
  });

  it('is not inflated by repeated lines', () => {
    const base = 'vale, ya\nlo hemos hecho';
    const inflated = `${base}\n${Array(40).fill('¡Ah! vale').join('\n')}`;
    expect(score(inflated, spanish.markers)).toBe(score(`${base}\n¡Ah! vale`, spanish.markers));
    expect(dedupeLines('A\na\n\n b \nA')).toBe('a \nb');
  });

  it('does not count os inside a word', () => {
    expect(score('los osos osan', spanish.markers)).toBe(0);
    expect(score('os vi', spanish.markers)).toBe(3);
  });

  it('counts a Spanish ending after an accented letter boundary', () => {
    expect(score('¿Queréis? ¡Vale!', spanish.markers)).toBe(6);
  });
});

describe('decide', () => {
  it('is undecided for two equal-scoring transcripts', () => {
    const verdict = decide(
      [
        { index: 2, text: 'hola uno' },
        { index: 3, text: 'hola dos' },
      ],
      spanish,
    );
    expect(verdict.kind).toBe('undecided');
  });

  it('is undecided below the margin and decided at it', () => {
    const near = decide(
      [
        { index: 2, text: 'vale\ntío\nuno distinto' },
        { index: 3, text: 'otra cosa totalmente' },
      ],
      spanish,
    );
    expect(near.kind).toBe('decided');
    const below = decide(
      [
        { index: 2, text: 'vale, uno distinto' },
        { index: 3, text: 'otra cosa totalmente' },
      ],
      spanish,
    );
    expect(below.kind).toBe('undecided');
  });

  it('gives the A tag to the higher scorer whichever stream it is', () => {
    const verdict = decide(
      [
        { index: 2, text: 'ustedes carajo ahorita' },
        { index: 3, text: 'vale vale tío vosotros' },
      ],
      spanish,
    );
    expect(verdict.kind === 'decided' && verdict.tags).toEqual({ 3: 'es-ES', 2: 'es-419' });
  });
});
