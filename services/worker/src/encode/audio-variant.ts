import { mkdtemp, rm } from 'node:fs/promises';
import { availableParallelism, tmpdir } from 'node:os';
import { join } from 'node:path';
import { EncodeCancelledError } from './cancellation';
import { findAudioVariantDetector, type AudioVariantDetector } from './audio-variant-detectors';
import { decide, type AudioVariantVerdict } from './audio-variant-score';
import { fileIdentity, readVerdict, writeVerdict } from './verdict-store';
import { runFfmpegCapture } from '../ffmpeg/capture';
import { normalizeIso3 } from '../ffmpeg/iso639';
import { detectVariant, NO_AUDIO_VARIANTS, type AudioVariantResolution } from '../ffmpeg/variants';

// Spec 110, REQ-7
export const VARIANT_WINDOWS = 3;
export const VARIANT_WINDOW_SECONDS = 120;
export const WHISPER_BINARY_DIR = '/opt/whisper';
export const WHISPER_MODEL = `${WHISPER_BINARY_DIR}/ggml-small-q5_1.bin`;

export interface AudioVariantDetails {
  audioVariantDetection?: boolean;
  allowedAudioLanguagesIso3: string[];
}

type Pair = [any, any];

function hasCentreChannel(stream: any): boolean {
  const layout: string = stream?.channel_layout ?? '';
  if (layout.includes('FC')) return true;
  return /^[3-9]\.[01]/.test(layout) && layout !== '3.0(back)';
}

export function windowStarts(duration: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('no readable container duration');
  const starts = new Set<number>();
  for (let i = 0; i < VARIANT_WINDOWS; i++) {
    const centre = (duration * (i + 1)) / (VARIANT_WINDOWS + 1);
    const start = Math.max(0, Math.min(duration - VARIANT_WINDOW_SECONDS, centre - VARIANT_WINDOW_SECONDS / 2));
    starts.add(Math.round(start * 1000) / 1000);
  }
  return [...starts];
}

export function buildWindowExtractArgs(input: string, stream: any, starts: number[], wav: string): string[] {
  const args = ['-v', 'error', '-nostdin', '-y'];
  for (const start of starts) args.push('-ss', String(start), '-t', String(VARIANT_WINDOW_SECONDS), '-i', input);
  const prep = hasCentreChannel(stream) ? 'pan=mono|c0=FC,' : '';
  const labels = starts.map((_, k) => `[a${k}]`).join('');
  const chains = starts.map((_, k) => `[${k}:${stream.index}]${prep}aresample=16000[a${k}]`);
  const filter = [...chains, `${labels}concat=n=${starts.length}:v=0:a=1[out]`].join(';');
  args.push('-filter_complex', filter, '-map', '[out]', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav);
  return args;
}

export function buildWhisperArgs(detector: AudioVariantDetector, wav: string): string[] {
  return ['-m', WHISPER_MODEL, '-l', detector.whisperLanguage, '-t', String(availableParallelism()), '-nt', '-np', '-f', wav];
}

function candidatePair(metadata: any, details: AudioVariantDetails): { detector: AudioVariantDetector; pair: Pair } | null {
  const streams: any[] = Array.isArray(metadata?.streams) ? metadata.streams : [];
  const audio = streams.filter((s) => s?.codec_type === 'audio');
  const allowed = new Set((details.allowedAudioLanguagesIso3 ?? []).map((lang) => normalizeIso3(lang)));
  for (const lang of allowed) {
    const detector = findAudioVariantDetector(lang);
    if (!detector) continue;
    const unresolved = audio.filter(
      (s) => normalizeIso3(s.tags?.language || '') === lang && detectVariant(s) === undefined,
    );
    if (unresolved.length === 2) return { detector, pair: [unresolved[0], unresolved[1]] };
  }
  return null;
}

async function detectVerdict(
  detector: AudioVariantDetector,
  pair: Pair,
  input: string,
  metadata: any,
  signal: AbortSignal,
): Promise<AudioVariantVerdict> {
  const starts = windowStarts(Number(metadata?.format?.duration));
  const dir = await mkdtemp(join(tmpdir(), 'perceptor-variant-'));
  try {
    const texts: string[] = [];
    for (const stream of pair) {
      const wav = join(dir, `${stream.index}.wav`);
      const extracted = await runFfmpegCapture(buildWindowExtractArgs(input, stream, starts, wav), signal);
      if (extracted.code !== 0) throw new Error(`ffmpeg window extraction exited with ${extracted.code}`);
      const transcribed = await runFfmpegCapture(buildWhisperArgs(detector, wav), signal, {
        binary: 'whisper-cli',
        keepStdout: true,
      });
      if (transcribed.code !== 0) throw new Error(`whisper-cli exited with ${transcribed.code}`);
      texts.push(transcribed.stdout ?? '');
    }
    return decide(
      [
        { index: pair[0].index, text: texts[0] },
        { index: pair[1].index, text: texts[1] },
      ],
      detector,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function toResolution(verdict: AudioVariantVerdict, pair: Pair): AudioVariantResolution {
  if (verdict.kind === 'decided') {
    return { tags: new Map(Object.entries(verdict.tags).map(([i, tag]) => [Number(i), tag])), duplicates: new Set() };
  }
  if (verdict.kind === 'duplicate') {
    const [first, second] = pair;
    const firstChannels = Number(first.channels ?? 0);
    const secondChannels = Number(second.channels ?? 0);
    const drop =
      firstChannels !== secondChannels
        ? firstChannels < secondChannels
          ? first
          : second
        : first.index > second.index
          ? first
          : second;
    return { tags: new Map(), duplicates: new Set([drop.index]) };
  }
  return NO_AUDIO_VARIANTS;
}

function logLine(detector: AudioVariantDetector, pair: Pair, verdict: AudioVariantVerdict, resolution: AudioVariantResolution): string {
  const [a, b] = pair;
  if (verdict.kind === 'duplicate') {
    const dropped = [...resolution.duplicates][0];
    return `[variant] ${detector.iso3} ${a.index}/${b.index} duplicate (similarity ${verdict.similarity.toFixed(2)}) → drop ${dropped}`;
  }
  const scores = `${a.index}:${verdict.scores[0]} ${b.index}:${verdict.scores[1]}`;
  if (verdict.kind === 'undecided') return `[variant] ${detector.iso3} ${scores} → undecided`;
  const assigned = [...resolution.tags.entries()].map(([i, tag]) => `${i}=${tag}`).join(' ');
  return `[variant] ${detector.iso3} ${scores} → ${assigned}`;
}

// Spec 110, REQ-5 REQ-6 REQ-7 REQ-9
export async function resolveAudioVariants(
  details: AudioVariantDetails,
  input: string,
  metadata: any,
  signal: AbortSignal,
): Promise<AudioVariantResolution> {
  if (details.audioVariantDetection !== true) return NO_AUDIO_VARIANTS;
  const candidate = candidatePair(metadata, details);
  if (!candidate) return NO_AUDIO_VARIANTS;
  const { detector, pair } = candidate;

  try {
    // Spec 110, REQ-8
    const file = await fileIdentity(input);
    const identity = file && { ...file, iso3: detector.iso3, streams: [pair[0].index, pair[1].index] };
    const stored = await readVerdict<AudioVariantVerdict>('audio-variant', identity);
    if (stored !== undefined) {
      const reused = toResolution(stored, pair);
      console.log(`${logLine(detector, pair, stored, reused)} (reused)`);
      return reused;
    }
    // Spec 110, REQ-12
    console.log(`[variant] ${detector.iso3} ${pair[0].index}/${pair[1].index} detecting input=${input}`);
    const verdict = await detectVerdict(detector, pair, input, metadata, signal);
    await writeVerdict('audio-variant', identity, verdict);
    const resolution = toResolution(verdict, pair);
    console.log(logLine(detector, pair, verdict, resolution));
    return resolution;
  } catch (error) {
    if (error instanceof EncodeCancelledError) throw error;
    console.log(`[variant] detection failed: ${error instanceof Error ? error.message : String(error)}`);
    return NO_AUDIO_VARIANTS;
  }
}
