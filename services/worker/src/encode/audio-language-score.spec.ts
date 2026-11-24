import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  decideLanguage,
  MIN_VOTES,
  parseDetectLanguage,
  parseVadSegments,
  pickSpeechWindows,
  VOTE_THRESHOLD,
  windowStarts,
} from './audio-language-score';

// Article IX: a misparsed whisper line, a silent clip that still prints a language, or a window
// picked on silence yields a wrong or missing audio language label with no error anywhere.

const FIXTURES = join(__dirname, '..', '..', 'fixtures', 'audio-language');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');

describe('windowStarts', () => {
  it('centres three 30 s windows at 25, 50 and 75 percent', () => {
    expect(windowStarts(6000)).toEqual([1485, 2985, 4485]);
  });

  it('clamps to zero and to duration minus 30 for a short file', () => {
    expect(windowStarts(20)).toEqual([0, 0, 0]);
    const starts = windowStarts(60);
    expect(starts.every((s) => s >= 0 && s <= 30)).toBe(true);
  });

  it('rejects an unreadable duration', () => {
    expect(() => windowStarts(0)).toThrow();
    expect(() => windowStarts(NaN)).toThrow();
  });
});

describe('parseDetectLanguage', () => {
  it('parses the real stderr of a speech clip', () => {
    const vote = parseDetectLanguage(fixture('speech.detect.stderr.txt'));
    expect(vote?.code).toBe('en');
    expect(vote?.probability).toBeCloseTo(0.970471, 6);
  });

  it('still parses the line for digital silence, with a low probability', () => {
    const vote = parseDetectLanguage(fixture('silent.detect.stderr.txt'));
    expect(vote?.code).toBe('en');
    expect(vote?.probability).toBeCloseTo(0.366482, 6);
    expect(decideLanguage([vote!, vote!, vote!])).toBeNull();
  });

  it('accepts an indented line', () => {
    expect(parseDetectLanguage('   whisper_full_with_state: auto-detected language: es (p = 0.91)')).toEqual({
      code: 'es',
      probability: 0.91,
    });
  });

  it('returns null, not a vote, when there is no line', () => {
    expect(parseDetectLanguage(fixture('speech.detect.stdout.txt'))).toBeNull();
    expect(parseDetectLanguage('')).toBeNull();
  });
});

describe('decideLanguage', () => {
  const v = (code: string, probability: number) => ({ code, probability });

  it('exposes the provisional constants', () => {
    expect(VOTE_THRESHOLD).toBe(0.8);
    expect(MIN_VOTES).toBe(2);
  });

  it('casts no vote below the threshold', () => {
    expect(decideLanguage([v('en', 0.79), v('en', 0.79), v('en', 0.79)])).toBeNull();
  });

  it('decides on two agreeing votes, ignoring a weak third', () => {
    expect(decideLanguage([v('en', 0.9), v('en', 0.8), v('fr', 0.3)])).toBe('eng');
  });

  it('is undecided with a single vote', () => {
    expect(decideLanguage([v('en', 0.99), v('en', 0.5)])).toBeNull();
  });

  it('is undecided when voting windows disagree', () => {
    expect(decideLanguage([v('en', 0.9), v('es', 0.9), v('en', 0.9)])).toBeNull();
  });

  it('is undecided for a code with no ISO 639-2/B mapping', () => {
    expect(decideLanguage([v('zz', 0.95), v('zz', 0.95)])).toBeNull();
  });
});

describe('parseVadSegments', () => {
  it('reads centisecond segments from the real stdout as seconds', () => {
    expect(parseVadSegments(fixture('speech.vad.stdout.txt'))).toEqual([
      { start: 0.03, end: 2.43 },
      { start: 2.75, end: 7.74 },
    ]);
  });

  it('returns an empty list for zero segments', () => {
    expect(parseVadSegments(fixture('silent.vad.stdout.txt'))).toEqual([]);
  });

  it('ignores stderr-style lines', () => {
    expect(parseVadSegments(fixture('speech.vad.stderr.txt'))).toEqual([]);
  });
});

describe('pickSpeechWindows', () => {
  it('is not valid when total speech is under 30 s', () => {
    expect(pickSpeechWindows([{ start: 100, end: 120 }], 3600)).toBeNull();
    expect(pickSpeechWindows([], 3600)).toBeNull();
  });

  it('takes the best three non-overlapping windows, sorted by start', () => {
    const segments = [
      { start: 100, end: 130 },
      { start: 500, end: 530 },
      { start: 900, end: 930 },
      { start: 1500, end: 1510 },
    ];
    const picked = pickSpeechWindows(segments, 3600)!;
    expect(picked).toHaveLength(3);
    expect(picked).toEqual([100, 500, 900]);
    for (let i = 1; i < picked.length; i++) expect(picked[i] - picked[i - 1]).toBeGreaterThanOrEqual(30);
  });

  it('does not overlap windows inside one long speech segment', () => {
    const picked = pickSpeechWindows([{ start: 0, end: 200 }], 300)!;
    expect(picked).toHaveLength(3);
    for (let i = 1; i < picked.length; i++) expect(picked[i] - picked[i - 1]).toBeGreaterThanOrEqual(30);
  });

  it('returns fewer windows when speech only fills one', () => {
    expect(pickSpeechWindows([{ start: 10, end: 40 }], 100)).toEqual([10]);
  });

  it('handles a file shorter than one window', () => {
    expect(pickSpeechWindows([{ start: 0, end: 25 }, { start: 26, end: 29 }], 29)).toBeNull();
    expect(pickSpeechWindows([{ start: 0, end: 31 }], 31)).toEqual([0]);
  });
});
