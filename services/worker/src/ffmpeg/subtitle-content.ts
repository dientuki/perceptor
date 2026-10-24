// Spec 102, REQ-4
export const SUBTITLE_SAMPLE_SECONDS = 900;
// Spec 102, REQ-6
export const SDH_SHARE_THRESHOLD = 0.1;
// Spec 102, REQ-7
export const SAME_TRANSLATION_START_TOLERANCE_SECONDS = 0.25;
// Spec 102, REQ-7
export const SAME_TRANSLATION_TEXT_SHARE = 0.95;
// Spec 102, REQ-9
export const CONTAINED_MIN_SAMPLED_CUES = 3;
// Spec 102, REQ-9
export const CONTAINED_MAX_SIZE_RATIO = 0.5;

export type Cue = { start: number; end: number; text: string };

export type TrackSample = {
  index: number;
  cues: Cue[];
  wholeCueCount: number | undefined;
  isDefault: boolean;
};

export type Verdict =
  | { keep: true }
  | { drop: 'sdh' }
  | { drop: 'same'; as: number }
  | { drop: 'contained'; in: number };

const TIMING = /(\d+):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d+):(\d{2}):(\d{2})[,.](\d{1,3})/;
const MARKUP = /<[^>]*>|\{[^}]*\}/g;
const BRACKETED = /\[[^\]]*\]|\([^)]*\)/;
const SPEAKER_LABEL = /(^|\n)\s*-?\s*\p{Lu}[\p{Lu}\d .'-]*\p{Lu}:/u;
const ITALIC = /<i>/i;

function seconds(h: string, m: string, s: string, ms: string): number {
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, '0')) / 1000;
}

// Spec 102, REQ-4
export function parseSrt(text: string): Cue[] {
  const cues: Cue[] = [];
  for (const block of text.replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    const lines = block.split('\n');
    const at = lines.findIndex((line) => TIMING.test(line));
    if (at < 0) continue;
    const t = TIMING.exec(lines[at])!;
    cues.push({
      start: seconds(t[1], t[2], t[3], t[4]),
      end: seconds(t[5], t[6], t[7], t[8]),
      text: lines
        .slice(at + 1)
        .join('\n')
        .trim(),
    });
  }
  return cues;
}

function stripMarkup(text: string): string {
  return text.replace(MARKUP, '');
}

function isAnnotated(cue: Cue): boolean {
  const text = stripMarkup(cue.text);
  return BRACKETED.test(text) || SPEAKER_LABEL.test(text);
}

// Spec 102, REQ-5
export function annotationShare(cues: Cue[]): number | null {
  if (cues.length === 0) return null;
  return cues.filter(isAnnotated).length / cues.length;
}

// Spec 102, REQ-7
export function normalizeCueText(text: string): string {
  return stripMarkup(text)
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/(^|\n)\s*[-–—]\s*/g, '$1- ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isHearingImpairedByContent(track: TrackSample): boolean {
  const share = annotationShare(track.cues);
  return share !== null && share >= SDH_SHARE_THRESHOLD;
}

function italicCues(track: TrackSample): number {
  return track.cues.filter((cue) => ITALIC.test(cue.text)).length;
}

// Spec 102, REQ-7
export function isSameTranslation(a: TrackSample, b: TrackSample): boolean {
  if (a.wholeCueCount === undefined || b.wholeCueCount === undefined) return false;
  if (a.wholeCueCount !== b.wholeCueCount) return false;
  if (a.cues.length === 0 || a.cues.length !== b.cues.length) return false;
  let identical = 0;
  for (let i = 0; i < a.cues.length; i++) {
    if (Math.abs(a.cues[i].start - b.cues[i].start) > SAME_TRANSLATION_START_TOLERANCE_SECONDS) {
      return false;
    }
    if (normalizeCueText(a.cues[i].text) === normalizeCueText(b.cues[i].text)) identical++;
  }
  return identical / a.cues.length >= SAME_TRANSLATION_TEXT_SHARE;
}

// Spec 102, REQ-9
export function isContainedIn(x: TrackSample, y: TrackSample): boolean {
  if (x.cues.length < CONTAINED_MIN_SAMPLED_CUES) return false;
  if (x.cues.length > y.cues.length * CONTAINED_MAX_SIZE_RATIO) return false;
  if (
    x.wholeCueCount !== undefined &&
    y.wholeCueCount !== undefined &&
    x.wholeCueCount > y.wholeCueCount * CONTAINED_MAX_SIZE_RATIO
  ) {
    return false;
  }
  return x.cues.every((cue) => {
    const needle = normalizeCueText(cue.text).toLowerCase();
    const haystack = y.cues
      .filter((other) => other.start < cue.end && other.end > cue.start)
      .map((other) => normalizeCueText(other.text).toLowerCase())
      .join(' ');
    return haystack.includes(needle);
  });
}

function bestOf(group: TrackSample[]): TrackSample {
  return [...group].sort(
    (a, b) =>
      italicCues(b) - italicCues(a) ||
      Number(b.isDefault) - Number(a.isDefault) ||
      a.index - b.index,
  )[0];
}

function groupSameTranslation(tracks: TrackSample[]): TrackSample[][] {
  const groups: TrackSample[][] = [];
  for (const track of tracks) {
    const matching = groups.filter((group) => group.some((m) => isSameTranslation(m, track)));
    const merged = [track, ...matching.flat()];
    for (const group of matching) groups.splice(groups.indexOf(group), 1);
    groups.push(merged);
  }
  return groups;
}

// Spec 102, REQ-3 REQ-6 REQ-7 REQ-8 REQ-9 REQ-10
export function pruneLanguage(tracks: TrackSample[]): Map<number, Verdict> {
  const verdicts = new Map<number, Verdict>(tracks.map((t) => [t.index, { keep: true }]));
  let alive = tracks;

  if (alive.length > 1) {
    const clean = alive.filter((t) => !isHearingImpairedByContent(t));
    if (clean.length > 0 && clean.length < alive.length) {
      for (const t of alive) {
        if (!clean.includes(t)) verdicts.set(t.index, { drop: 'sdh' });
      }
      alive = clean;
    }
  }

  if (alive.length > 1) {
    const survivors: TrackSample[] = [];
    for (const group of groupSameTranslation(alive)) {
      const best = bestOf(group);
      survivors.push(best);
      for (const t of group) {
        if (t !== best) verdicts.set(t.index, { drop: 'same', as: best.index });
      }
    }
    alive = alive.filter((t) => survivors.includes(t));
  }

  if (alive.length > 1) {
    const contained = new Map<number, number>();
    for (const x of alive) {
      const y = alive.find((other) => other !== x && isContainedIn(x, other));
      if (y) contained.set(x.index, y.index);
    }
    for (const [x, y] of contained) verdicts.set(x, { drop: 'contained', in: y });
  }

  return new Map(tracks.map((t) => [t.index, verdicts.get(t.index)!]));
}
