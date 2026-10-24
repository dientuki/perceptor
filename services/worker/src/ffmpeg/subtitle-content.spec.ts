// Subtitle content pruning fails silently in both directions: a wrong verdict
// either removes the only good track of a language (the title is then
// downloaded and encoded again) or leaves clutter such as byte-identical SDH
// tracks in the library, and in neither case does any error surface. The rules
// are tested against scrambled real samples (fixtures/subtitle-content/: every
// word replaced by random letters, timings, markup, brackets and cue counts
// kept) whose expected verdicts come from the spec's calibration table, plus
// synthesised tracks for each edge of a threshold: exactly 10 %, just under,
// a 300 ms offset, two sampled cues, a missing whole-track cue count, one
// uncontained cue, and a small track over half the size of the large one.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  annotationShare,
  isContainedIn,
  isSameTranslation,
  normalizeCueText,
  parseSrt,
  pruneLanguage,
  type Cue,
  type TrackSample,
  type Verdict,
} from './subtitle-content';

type ManifestTrack = {
  index: number;
  language: string;
  isDefault: boolean;
  numberOfFrames: number | null;
  expect: string;
};

const root = join(__dirname, '../../fixtures/subtitle-content');
const manifest: { films: Record<string, { tracks: ManifestTrack[] }> } = JSON.parse(
  readFileSync(join(root, 'manifest.json'), 'utf8'),
);

function sample(film: string, track: ManifestTrack): TrackSample {
  return {
    index: track.index,
    cues: parseSrt(readFileSync(join(root, film, `${track.index}.srt`), 'utf8')),
    wholeCueCount: track.numberOfFrames ?? undefined,
    isDefault: track.isDefault,
  };
}

function track(film: string, index: number): ManifestTrack {
  return manifest.films[film].tracks.find((t) => t.index === index)!;
}

function group(film: string, language: string, indices?: number[]): TrackSample[] {
  return manifest.films[film].tracks
    .filter((t) => t.language === language && (!indices || indices.includes(t.index)))
    .map((t) => sample(film, t));
}

function verdictText(v: Verdict): string {
  if ('keep' in v) return 'keep';
  if (v.drop === 'sdh') return 'sdh';
  return v.drop === 'same' ? `same as ${v.as}` : `contained in ${v.in}`;
}

function verdicts(tracks: TrackSample[]): Record<number, string> {
  return Object.fromEntries(
    [...pruneLanguage(tracks)].map(([index, v]) => [index, verdictText(v)]),
  );
}

function cue(start: number, text: string, length = 2): Cue {
  return { start, end: start + length, text };
}

function synth(
  index: number,
  cues: Cue[],
  extra: Partial<TrackSample> = {},
): TrackSample {
  return { index, cues, wholeCueCount: cues.length, isDefault: false, ...extra };
}

function numbered(count: number, text: (i: number) => string, offset = 0): Cue[] {
  return Array.from({ length: count }, (_, i) => cue(i * 5 + offset, text(i)));
}

function plain(count: number, offset = 0): Cue[] {
  return numbered(count, (i) => `Line number ${i} said`, offset);
}

describe('calibration fixtures through pruneLanguage', () => {
  const groups: [string, string, number[] | undefined][] = [
    ['dragon', 'eng', [3, 4, 5, 6]],
    ['wake', 'eng', [3, 4]],
    ['wake', 'spa', [5, 6]],
    ['help', 'eng', [2, 3]],
    ['blonde', 'eng', [2, 3]],
  ];

  for (const [film, language, indices] of groups) {
    it(`${film} ${language} ${indices!.join(',')} matches the manifest`, () => {
      const expected = Object.fromEntries(
        indices!.map((i) => [i, track(film, i).expect]),
      );
      expect(verdicts(group(film, language, indices))).toEqual(expected);
    });
  }

  it('reads the Dragon shares from the scrambled samples', () => {
    const share = (i: number) => annotationShare(sample('dragon', track('dragon', i)).cues);
    expect(share(3)).toBeCloseTo(0.012, 3);
    expect(share(4)).toBeCloseTo(0.012, 3);
    expect(share(5)).toBeCloseTo(0.347, 3);
    expect(share(6)).toBeCloseTo(0.347, 3);
  });

  it('counts a non-ASCII speaker label (Wake Up Dead Man Spanish 0.4 %)', () => {
    expect(annotationShare(sample('wake', track('wake', 5)).cues)).toBeCloseTo(0.004, 3);
  });

  it('reads The Help SDH at 17.5 % and its plain track at 0 %', () => {
    expect(annotationShare(sample('help', track('help', 3)).cues)).toBeCloseTo(0.175, 3);
    expect(annotationShare(sample('help', track('help', 2)).cues)).toBe(0);
  });

  it('does not count music notes: The Running Man track 3 is not SDH', () => {
    const running = sample('running', track('running', 3));
    expect(running.cues.some((c) => /[♪♫]/.test(c.text))).toBe(true);
    expect(annotationShare(running.cues)).toBe(0);
    expect(
      verdicts([running, sample('running', track('running', 4))])[3],
    ).toBe('keep');
  });

  it('gives the Dragon tracks 5 and 6 as one SDH pair, never collapsed against 3', () => {
    expect(verdicts(group('dragon', 'eng', [3, 5, 6]))).toEqual({
      3: 'keep',
      5: 'sdh',
      6: 'sdh',
    });
  });

  it('keeps the italic Dragon track 3 over 4 even when 4 is the default', () => {
    const three = { ...sample('dragon', track('dragon', 3)), isDefault: false };
    const four = { ...sample('dragon', track('dragon', 4)), isDefault: true };
    expect(verdicts([three, four])).toEqual({ 3: 'keep', 4: 'same as 3' });
  });

  it('collapses identical SDH tracks to one when all are hearing-impaired', () => {
    expect(verdicts(group('dragon', 'eng', [5, 6]))).toEqual({ 5: 'keep', 6: 'same as 5' });
  });

  it('keeps Atomic Blonde forced when whole-track counts are present and compatible', () => {
    const forced = { ...sample('blonde', track('blonde', 2)), wholeCueCount: 79 };
    const full = { ...sample('blonde', track('blonde', 3)), wholeCueCount: 991 };
    expect(verdicts([forced, full])).toEqual({ 2: 'contained in 3', 3: 'keep' });
  });

  it('keeps Atomic Blonde forced when its whole-track size is over half the full one', () => {
    const forced = { ...sample('blonde', track('blonde', 2)), wholeCueCount: 600 };
    const full = { ...sample('blonde', track('blonde', 3)), wholeCueCount: 991 };
    expect(verdicts([forced, full])).toEqual({ 2: 'keep', 3: 'keep' });
  });
});

describe('C1 hearing-impaired by content', () => {
  const sdhShare = (sdhCues: number, total: number) =>
    numbered(total, (i) => (i < sdhCues ? '[door closes]' : `Line number ${i} said`));

  it('drops a track at exactly 10 %', () => {
    const result = verdicts([synth(1, plain(30)), synth(2, sdhShare(3, 30))]);
    expect(result).toEqual({ 1: 'keep', 2: 'sdh' });
  });

  it('keeps a track just under 10 %', () => {
    const result = verdicts([synth(1, plain(30)), synth(2, sdhShare(2, 30))]);
    expect(result[2]).toBe('keep');
  });

  it('keeps every track when all are hearing-impaired and differ', () => {
    const a = numbered(20, (i) => `[noise ${i}]`);
    const b = numbered(20, (i) => `(other ${i})`, 0);
    expect(verdicts([synth(1, a), synth(2, b)])).toEqual({ 1: 'keep', 2: 'keep' });
  });

  it('keeps every track when none is hearing-impaired and they differ', () => {
    const a = numbered(20, (i) => `First ${i} words`);
    const b = numbered(20, (i) => `Second ${i} phrase`);
    expect(verdicts([synth(1, a), synth(2, b)])).toEqual({ 1: 'keep', 2: 'keep' });
  });

  it('counts parenthesised annotations and labels, not music notes', () => {
    expect(annotationShare([cue(0, '(DOOR CLOSES)')])).toBe(1);
    expect(annotationShare([cue(0, '- ASTRID: Hello')])).toBe(1);
    expect(annotationShare([cue(0, 'MARÍA: Hola')])).toBe(1);
    expect(annotationShare([cue(0, '♪ la la ♪')])).toBe(0);
    expect(annotationShare([cue(0, '<i>[door]</i>')])).toBe(1);
    expect(annotationShare([cue(0, 'Hello: there')])).toBe(0);
  });

  it('has no share without cues and does not treat the track as SDH', () => {
    expect(annotationShare([])).toBeNull();
    expect(verdicts([synth(1, plain(10)), synth(2, [])])).toEqual({ 1: 'keep', 2: 'keep' });
  });
});

describe('C2 same translation', () => {
  it('collapses identical tracks', () => {
    expect(verdicts([synth(1, plain(20)), synth(2, plain(20, 0.08))])).toEqual({
      1: 'keep',
      2: 'same as 1',
    });
  });

  it('keeps both when the whole-track cue counts differ', () => {
    const a = synth(1, plain(20), { wholeCueCount: 1000 });
    const b = synth(2, plain(20), { wholeCueCount: 1001 });
    expect(isSameTranslation(a, b)).toBe(false);
    expect(verdicts([a, b])).toEqual({ 1: 'keep', 2: 'keep' });
  });

  it('keeps both when a whole-track cue count is missing', () => {
    const a = synth(1, plain(20), { wholeCueCount: undefined });
    const b = synth(2, plain(20));
    expect(verdicts([a, b])).toEqual({ 1: 'keep', 2: 'keep' });
    expect(verdicts([a, { ...b, wholeCueCount: undefined }])).toEqual({
      1: 'keep',
      2: 'keep',
    });
  });

  it('keeps both at a 300 ms start offset and collapses at 200 ms', () => {
    expect(verdicts([synth(1, plain(20)), synth(2, plain(20, 0.3))])).toEqual({
      1: 'keep',
      2: 'keep',
    });
    expect(verdicts([synth(1, plain(20)), synth(2, plain(20, 0.2))])[2]).toBe('same as 1');
  });

  it('keeps both when different translations share timing', () => {
    const other = numbered(20, (i) => `Different ${i} wording`);
    expect(verdicts([synth(1, plain(20)), synth(2, other)])).toEqual({ 1: 'keep', 2: 'keep' });
  });

  it('keeps both when the cue lists do not align', () => {
    expect(verdicts([synth(1, plain(20), { wholeCueCount: 5 }), synth(2, plain(19), { wholeCueCount: 5 })]))
      .toEqual({ 1: 'keep', 2: 'keep' });
  });

  it('needs 95 % identical cues: 19 of 20 collapse, 18 of 20 do not', () => {
    const variant = (changed: number) =>
      plain(20).map((c, i) => (i < changed ? { ...c, text: `Changed ${i}` } : c));
    expect(verdicts([synth(1, plain(20)), synth(2, variant(1))])[2]).toBe('same as 1');
    expect(verdicts([synth(1, plain(20)), synth(2, variant(2))])[2]).toBe('keep');
  });

  it('prefers italics, then default, then the lower index', () => {
    const italic = numbered(20, (i) => `<i>Line number ${i} said</i>`);
    expect(verdicts([synth(1, plain(20)), synth(2, italic)])).toEqual({
      1: 'same as 2',
      2: 'keep',
    });
    expect(verdicts([synth(1, plain(20)), synth(2, plain(20), { isDefault: true })])).toEqual({
      1: 'same as 2',
      2: 'keep',
    });
    expect(verdicts([synth(2, plain(20)), synth(1, plain(20))])).toEqual({
      2: 'same as 1',
      1: 'keep',
    });
  });

  it('folds markup, quotes and dash spacing but keeps case', () => {
    expect(normalizeCueText('<i>It’s “fine”</i>\n-Yes')).toBe('It\'s "fine" - Yes');
    expect(normalizeCueText('It\'s "fine"\n- Yes')).toBe('It\'s "fine" - Yes');
    expect(normalizeCueText('{\\an8}Hello')).toBe('Hello');
    expect(normalizeCueText('Hello')).not.toBe(normalizeCueText('hello'));
  });
});

describe('C3 contained in another track', () => {
  const full = () =>
    numbered(60, (i) => `Everything said in line ${i}`).map((c, i) =>
      i % 20 === 0 ? { ...c, text: `Hola amigo ${i}\nEverything said in line ${i}` } : c,
    );
  const forcedFrom = (cues: Cue[], picks: number[]) =>
    picks.map((i) => ({ ...cues[i], text: `Hola amigo ${i}`.toLowerCase() }));

  it('drops a small track whose every cue is inside the large one', () => {
    const big = full();
    const small = synth(1, forcedFrom(big, [0, 20, 40]), { wholeCueCount: undefined });
    expect(verdicts([small, synth(2, big, { wholeCueCount: undefined })])).toEqual({
      1: 'contained in 2',
      2: 'keep',
    });
  });

  it('keeps a small track with one uncontained cue', () => {
    const big = full();
    const cues = forcedFrom(big, [0, 20, 40]);
    cues[2] = { ...cues[2], text: 'nothing like this' };
    expect(verdicts([synth(1, cues), synth(2, big)])).toEqual({ 1: 'keep', 2: 'keep' });
  });

  it('keeps a small track with only 2 sampled cues, all found', () => {
    const big = full();
    const small = synth(1, forcedFrom(big, [0, 20]));
    expect(isContainedIn(small, synth(2, big))).toBe(false);
    expect(verdicts([small, synth(2, big)])).toEqual({ 1: 'keep', 2: 'keep' });
  });

  it('keeps a small track over half the size of the large one', () => {
    const big = full().slice(0, 6);
    const small = synth(1, forcedFrom(big, [0, 1, 2, 3]), { wholeCueCount: undefined });
    expect(verdicts([small, synth(2, big, { wholeCueCount: undefined })])).toEqual({
      1: 'keep',
      2: 'keep',
    });
  });

  it('accepts a small track at exactly half the size', () => {
    const big = numbered(6, (i) => `Said ${i}`);
    const small = synth(1, [big[0], big[2], big[4]], { wholeCueCount: undefined });
    expect(isContainedIn(small, synth(2, big, { wholeCueCount: undefined }))).toBe(true);
  });

  it('keeps a track when whole-track counts show it is over half the size', () => {
    const big = full();
    const small = synth(1, forcedFrom(big, [0, 20, 40]), { wholeCueCount: 70 });
    expect(isContainedIn(small, synth(2, big, { wholeCueCount: 100 }))).toBe(false);
  });

  it('ignores a cue that only overlaps a different cue of the large track', () => {
    const big = numbered(10, (i) => `Said ${i}`);
    const small = synth(1, [
      { ...big[0], text: 'Said 0' },
      { ...big[1], text: 'Said 0' },
      { ...big[2], text: 'Said 2' },
    ]);
    expect(isContainedIn(small, synth(2, big))).toBe(false);
  });
});

describe('language with a single track', () => {
  it('keeps it', () => {
    expect(verdicts([synth(1, numbered(10, (i) => `[x ${i}]`))])).toEqual({ 1: 'keep' });
  });
});

describe('parseSrt', () => {
  it('reads CRLF, a missing trailing blank line and comma or dot milliseconds', () => {
    const text = '1\r\n00:00:01,500 --> 00:00:03,000\r\nHello\r\nthere\r\n\r\n2\r\n00:01:00.250 --> 00:01:02,000\r\nBye';
    expect(parseSrt(text)).toEqual([
      { start: 1.5, end: 3, text: 'Hello\nthere' },
      { start: 60.25, end: 62, text: 'Bye' },
    ]);
  });

  it('skips a block with no timing line and keeps the rest', () => {
    const text = '1\n00:00:01,000 --> 00:00:02,000\nOne\n\n2\nnot a timing\nbroken\n\n3\n00:00:05,000 --> 00:00:06,000\nThree\n';
    expect(parseSrt(text).map((c) => c.text)).toEqual(['One', 'Three']);
  });

  it('returns no cues for empty or unparseable text', () => {
    expect(parseSrt('')).toEqual([]);
    expect(parseSrt('garbage')).toEqual([]);
  });

  it('parses every fixture track to its manifest cue count', () => {
    for (const [film, data] of Object.entries(manifest.films)) {
      for (const t of data.tracks) {
        const expected = (t as ManifestTrack & { sampledCues: number }).sampledCues;
        expect(sample(film, t).cues.length).toBe(expected);
      }
    }
  });
});
