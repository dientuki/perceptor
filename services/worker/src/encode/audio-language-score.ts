import { iso1ToIso3 } from '../ffmpeg/iso639';

// Spec 122, REQ-2
export const DETECTOR_REVISION = 1;
export const VOTE_THRESHOLD = 0.8;
export const MIN_VOTES = 2;
export const LANGUAGE_WINDOWS = 3;
export const LANGUAGE_WINDOW_SECONDS = 30;

export interface LanguageVote {
  code: string;
  probability: number;
}

export interface SpeechSegment {
  start: number;
  end: number;
}

export function windowStarts(duration: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('no readable container duration');
  const max = Math.max(0, duration - LANGUAGE_WINDOW_SECONDS);
  const starts: number[] = [];
  for (let i = 0; i < LANGUAGE_WINDOWS; i++) {
    const centre = (duration * (i + 1)) / (LANGUAGE_WINDOWS + 1);
    const start = Math.min(max, Math.max(0, centre - LANGUAGE_WINDOW_SECONDS / 2));
    starts.push(Math.round(start * 1000) / 1000);
  }
  return starts;
}

// Spec 122, REQ-3
const DETECT_LINE = /auto-detected language:\s*([A-Za-z]{2,3})\s*\(p\s*=\s*([0-9]*\.?[0-9]+)\)/;

export function parseDetectLanguage(output: string): LanguageVote | null {
  const match = DETECT_LINE.exec(output ?? '');
  if (!match) return null;
  const probability = Number(match[2]);
  if (!Number.isFinite(probability)) return null;
  return { code: match[1].toLowerCase(), probability };
}

export function decideLanguage(votes: LanguageVote[]): string | null {
  const voting = votes.filter((v) => v.probability >= VOTE_THRESHOLD);
  if (voting.length < MIN_VOTES) return null;
  const first = voting[0].code;
  if (!voting.every((v) => v.code === first)) return null;
  return iso1ToIso3(first) ?? null;
}

// Spec 122, REQ-4
const VAD_LINE = /^\s*Speech segment\s+\d+:\s*start\s*=\s*([0-9]*\.?[0-9]+),\s*end\s*=\s*([0-9]*\.?[0-9]+)\s*$/;

export function parseVadSegments(stdout: string): SpeechSegment[] {
  const segments: SpeechSegment[] = [];
  for (const line of (stdout ?? '').split(/\r?\n/)) {
    const match = VAD_LINE.exec(line);
    if (!match) continue;
    const start = Number(match[1]) / 100;
    const end = Number(match[2]) / 100;
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) segments.push({ start, end });
  }
  return segments;
}

export const MIN_TOTAL_SPEECH_SECONDS = 30;

export function pickSpeechWindows(segments: SpeechSegment[], duration: number): number[] | null {
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const cells = Math.ceil(duration);
  const speech = new Array<number>(cells).fill(0);
  let total = 0;
  for (const seg of segments) {
    const start = Math.max(0, seg.start);
    const end = Math.min(duration, seg.end);
    if (end <= start) continue;
    total += end - start;
    for (let c = Math.floor(start); c < Math.min(cells, Math.ceil(end)); c++) {
      speech[c] += Math.min(end, c + 1) - Math.max(start, c);
    }
  }
  if (total < MIN_TOTAL_SPEECH_SECONDS) return null;

  const prefix = new Array<number>(cells + 1).fill(0);
  for (let c = 0; c < cells; c++) prefix[c + 1] = prefix[c] + speech[c];

  const lastStart = Math.max(0, Math.floor(duration - LANGUAGE_WINDOW_SECONDS));
  const scored: { start: number; speech: number }[] = [];
  for (let s = 0; s <= lastStart; s++) {
    const to = Math.min(cells, s + LANGUAGE_WINDOW_SECONDS);
    scored.push({ start: s, speech: prefix[to] - prefix[s] });
  }
  scored.sort((a, b) => b.speech - a.speech || a.start - b.start);

  const picked: number[] = [];
  for (const candidate of scored) {
    if (picked.length === LANGUAGE_WINDOWS) break;
    if (candidate.speech <= 0) break;
    if (picked.some((p) => Math.abs(p - candidate.start) < LANGUAGE_WINDOW_SECONDS)) continue;
    picked.push(candidate.start);
  }
  return picked.length > 0 ? picked.sort((a, b) => a - b) : null;
}
