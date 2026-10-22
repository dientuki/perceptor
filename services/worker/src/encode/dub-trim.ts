import { EncodeCancelledError } from './cancellation';
import { runFfmpegCapture } from '../ffmpeg/capture';

// Spec 098, REQ-5
export const DUB_TRIM_WINDOW_SECONDS = 300;
// Spec 098, REQ-6
export const DUB_TRIM_MAX_GAP_SECONDS = 0.2;
export const DUB_TRIM_EOF_TOLERANCE_SECONDS = 0.5;
export const DUB_TRIM_FILTER = 'scale=320:-2,freezedetect=n=0.003:d=1';
// Spec 098, REQ-7
export const DUB_TRIM_CARD_UNIT_SECONDS = 2.002;
export const DUB_TRIM_UNIT_TOLERANCE_SECONDS = 0.06;
export const DUB_TRIM_MIN_TRAILING_CARDS = 5;
export const DUB_TRIM_MIN_EXACT_CARDS = 3;
export const DUB_TRIM_MIN_TRUNCATED_SECONDS = 0.5;

export interface Freeze {
  start: number;
  end: number;
}

export interface TailClassification {
  runStart: number | null;
  cards: number;
  multiples: number;
  exact: number;
}

function parseClock(value: unknown): number {
  if (typeof value !== 'string') return NaN;
  const match = /^(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(value.trim());
  if (!match) return NaN;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function positiveFinite(value: unknown): number {
  const n = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : NaN;
}

// Spec 098, REQ-5
export function videoEndSeconds(metadata: any): number {
  const streams: any[] = Array.isArray(metadata?.streams) ? metadata.streams : [];
  const video = streams.find((s) => s?.codec_type === 'video');

  const fromStream = positiveFinite(video?.duration);
  if (Number.isFinite(fromStream)) return fromStream;

  const tags = video?.tags ?? {};
  const fromTag = parseClock(tags.DURATION ?? tags.duration);
  if (Number.isFinite(fromTag) && fromTag > 0) return fromTag;

  return positiveFinite(metadata?.format?.duration);
}

// Spec 098, REQ-6
export function parseFreezes(stderr: string, windowLength: number): Freeze[] {
  const freezes: Freeze[] = [];
  let open: number | null = null;
  for (const line of stderr.split(/\r?\n/)) {
    const start = /freeze_start:\s*(-?[\d.]+)/.exec(line);
    if (start) {
      open = Number(start[1]);
      continue;
    }
    const end = /freeze_end:\s*(-?[\d.]+)/.exec(line);
    if (end && open !== null) {
      freezes.push({ start: open, end: Number(end[1]) });
      open = null;
    }
  }
  if (open !== null) freezes.push({ start: open, end: windowLength });
  return freezes;
}

function cardMultiple(duration: number): number {
  const k = Math.round(duration / DUB_TRIM_CARD_UNIT_SECONDS);
  if (k < 1) return 0;
  return Math.abs(duration - k * DUB_TRIM_CARD_UNIT_SECONDS) <= DUB_TRIM_UNIT_TOLERANCE_SECONDS + 1e-9 ? k : 0;
}

// Spec 098, REQ-6 REQ-7
export function classifyTail(freezes: Freeze[], windowLength: number): TailClassification {
  const none: TailClassification = { runStart: null, cards: 0, multiples: 0, exact: 0 };
  if (freezes.length === 0) return none;

  const last = freezes[freezes.length - 1];
  if (windowLength - last.end > DUB_TRIM_EOF_TOLERANCE_SECONDS) return none;

  let first = freezes.length - 1;
  while (first > 0 && freezes[first].start - freezes[first - 1].end <= DUB_TRIM_MAX_GAP_SECONDS) {
    first -= 1;
  }

  const run = freezes.slice(first);
  const durations = run.map((f) => f.end - f.start);
  const lastDuration = durations[durations.length - 1];
  if (cardMultiple(lastDuration) === 0 && lastDuration >= DUB_TRIM_MIN_TRUNCATED_SECONDS) {
    durations.pop();
  }

  let multiples = 0;
  let exact = 0;
  for (let i = durations.length - 1; i >= 0; i -= 1) {
    const k = cardMultiple(durations[i]);
    if (k === 0) break;
    multiples += 1;
    if (k === 1) exact += 1;
  }
  return { runStart: run[0].start, cards: run.length, multiples, exact };
}

// Spec 098, REQ-7
export function isDubTail(result: TailClassification): boolean {
  return (
    result.runStart !== null &&
    result.multiples >= DUB_TRIM_MIN_TRAILING_CARDS &&
    result.exact >= DUB_TRIM_MIN_EXACT_CARDS
  );
}

export interface DubTailDetection {
  cards: number;
  multiples: number;
  cut: number | null;
}

// Spec 098, REQ-5 REQ-6 REQ-8
export async function detectDubTail(
  input: string,
  metadata: any,
  signal: AbortSignal,
): Promise<DubTailDetection> {
  const end = videoEndSeconds(metadata);
  if (!Number.isFinite(end)) throw new Error('no readable video duration');

  const windowStart = Math.max(0, end - DUB_TRIM_WINDOW_SECONDS);
  const windowLength = end - windowStart;

  const result = await runFfmpegCapture(
    [
      '-hide_banner',
      '-nostdin',
      '-nostats',
      '-ss',
      windowStart.toFixed(3),
      '-t',
      windowLength.toFixed(3),
      '-i',
      input,
      '-map',
      '0:v:0',
      '-an',
      '-sn',
      '-vf',
      DUB_TRIM_FILTER,
      '-f',
      'null',
      '-',
    ],
    signal,
  );
  if (result.code !== 0) throw new Error(`ffmpeg freezedetect exited with ${result.code}`);

  const tail = classifyTail(parseFreezes(result.stderr, windowLength), windowLength);
  const cut = isDubTail(tail) && tail.runStart !== null ? windowStart + tail.runStart : null;
  return { cards: tail.cards, multiples: tail.multiples, cut };
}

// Spec 098, REQ-11
const verdictCache = new Map<string, number | null>();

export function resetDubTrimCache(): void {
  verdictCache.clear();
}

// Spec 098, REQ-3 REQ-11 REQ-12 NFR-1
export async function resolveDubTrim(
  details: { dubTrimEnabled: boolean },
  input: string,
  metadata: any,
  signal: AbortSignal,
): Promise<number | null> {
  if (!details.dubTrimEnabled) return null;

  if (verdictCache.has(input)) return verdictCache.get(input) ?? null;

  try {
    const detection = await detectDubTail(input, metadata, signal);
    // A cut at or below zero would produce an empty file; treat it as keep.
    const cut = detection.cut !== null && detection.cut > 0 ? detection.cut : null;
    verdictCache.set(input, cut);
    console.log(
      `[dubtrim] input=${input} cards=${detection.cards} multiples=${detection.multiples} -> ` +
        (cut === null ? 'keep' : `cut=${cut.toFixed(3)}`),
    );
    return cut;
  } catch (error) {
    if (error instanceof EncodeCancelledError) throw error;
    return null;
  }
}
