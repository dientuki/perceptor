import { mkdtemp, rm } from 'node:fs/promises';
import { availableParallelism, tmpdir } from 'node:os';
import { join } from 'node:path';
import { EncodeCancelledError } from './cancellation';
import { hasCentreChannel, WHISPER_BINARY_DIR, WHISPER_MODEL } from './audio-variant';
import {
  DETECTOR_REVISION,
  LANGUAGE_WINDOW_SECONDS,
  decideLanguage,
  parseDetectLanguage,
  parseVadSegments,
  pickSpeechWindows,
  windowStarts,
  type LanguageVote,
} from './audio-language-score';
import { fileIdentity, readVerdict, writeVerdict } from './verdict-store';
import { runFfmpegCapture } from '../ffmpeg/capture';
import { findAudioCandidates } from '../ffmpeg/params';
import { NO_AUDIO_VARIANTS } from '../ffmpeg/variants';
import { ERROR_ENCODE_ORIGINAL_AUDIO_UNDETERMINED } from '../i18n/error-keys';
import { KeyedError } from '../i18n/keyed-error';
import { renderMessage } from '../i18n/messages.en';

export const VAD_MODEL = `${WHISPER_BINARY_DIR}/ggml-silero-v5.1.2.bin`;

// Spec 122, REQ-2
const BLACKLIST = ['commentary', 'description', 'visual', 'sdh'];

export interface AudioLanguageDetails {
  compressionEnabled?: boolean;
  originalLanguageIso3: string;
  allowedAudioLanguagesIso3: string[];
}

export interface AudioLanguageResolution {
  metadata: any;
  undetermined: number[];
}

type Verdict = { iso3: string } | { undecided: true };

function audioStreamsOf(metadata: any): any[] {
  const streams: any[] = Array.isArray(metadata?.streams) ? metadata.streams : [];
  return streams.filter((s) => s?.codec_type === 'audio');
}

// Spec 122, REQ-1 REQ-2
function untaggedCandidates(audio: any[]): any[] {
  return audio.filter((s) => {
    const tag = String(s.tags?.language ?? '').trim().toLowerCase();
    if (tag !== '' && tag !== 'und') return false;
    const title = String(s.tags?.title ?? '').toLowerCase();
    if (BLACKLIST.some((word) => title.includes(word))) return false;
    return Number(s.disposition?.comment ?? 0) !== 1;
  });
}

export function buildLanguageWindowArgs(input: string, stream: any, start: number, wav: string): string[] {
  const prep = hasCentreChannel(stream) ? 'pan=mono|c0=FC,' : '';
  return [
    '-v', 'error', '-nostdin', '-y',
    '-ss', String(start), '-t', String(LANGUAGE_WINDOW_SECONDS), '-i', input,
    '-map', `0:${stream.index}`, '-af', `${prep}aresample=16000`,
    '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav,
  ];
}

export function buildWholeStreamArgs(input: string, stream: any, wav: string): string[] {
  const prep = hasCentreChannel(stream) ? 'pan=mono|c0=FC,' : '';
  return [
    '-v', 'error', '-nostdin', '-y', '-i', input,
    '-map', `0:${stream.index}`, '-af', `${prep}aresample=16000`,
    '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav,
  ];
}

export function buildDetectArgs(wav: string): string[] {
  return ['-m', WHISPER_MODEL, '-l', 'auto', '--detect-language', '-t', String(availableParallelism()), '-f', wav];
}

async function identify(
  input: string,
  stream: any,
  starts: number[],
  dir: string,
  tag: string,
  signal: AbortSignal,
): Promise<LanguageVote[]> {
  const votes: LanguageVote[] = [];
  for (const [k, start] of starts.entries()) {
    const wav = join(dir, `${stream.index}-${tag}-${k}.wav`);
    const extracted = await runFfmpegCapture(buildLanguageWindowArgs(input, stream, start, wav), signal);
    if (extracted.code !== 0) throw new Error(`ffmpeg window extraction exited with ${extracted.code}`);
    const detected = await runFfmpegCapture(buildDetectArgs(wav), signal, { binary: 'whisper-cli', keepStdout: true });
    if (detected.code !== 0) throw new Error(`whisper-cli exited with ${detected.code}`);
    const vote = parseDetectLanguage(`${detected.stderr ?? ''}\n${detected.stdout ?? ''}`);
    if (!vote) throw new Error('whisper-cli printed no language verdict');
    votes.push(vote);
  }
  return votes;
}

const describeVotes = (votes: LanguageVote[]): string =>
  votes.map((v) => `${v.code}:${v.probability.toFixed(2)}`).join(' ');

// Spec 122, REQ-3 REQ-4
async function detectStream(
  input: string,
  stream: any,
  duration: number,
  signal: AbortSignal,
): Promise<Verdict> {
  const dir = await mkdtemp(join(tmpdir(), 'perceptor-language-'));
  try {
    const first = await identify(input, stream, windowStarts(duration), dir, 'a1', signal);
    const iso3 = decideLanguage(first);
    console.log(`[language] stream ${stream.index} attempt 1 ${describeVotes(first)} → ${iso3 ?? 'not valid'}`);
    if (iso3) return { iso3 };

    const whole = join(dir, `${stream.index}-whole.wav`);
    const extracted = await runFfmpegCapture(buildWholeStreamArgs(input, stream, whole), signal);
    if (extracted.code !== 0) throw new Error(`ffmpeg stream extraction exited with ${extracted.code}`);
    const vad = await runFfmpegCapture(['-vm', VAD_MODEL, '-f', whole], signal, {
      binary: 'whisper-vad-speech-segments',
      keepStdout: true,
    });
    if (vad.code !== 0) throw new Error(`whisper-vad-speech-segments exited with ${vad.code}`);
    const starts = pickSpeechWindows(parseVadSegments(vad.stdout ?? ''), duration);
    if (!starts) {
      console.log(`[language] stream ${stream.index} attempt 2 no speech found → undecided`);
      return { undecided: true };
    }
    const second = await identify(input, stream, starts, dir, 'a2', signal);
    const decided = decideLanguage(second);
    console.log(`[language] stream ${stream.index} attempt 2 ${describeVotes(second)} → ${decided ?? 'undecided'}`);
    return decided ? { iso3: decided } : { undecided: true };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Spec 122, REQ-1 REQ-2 REQ-5 REQ-6 REQ-7 REQ-8 REQ-9 REQ-10
export async function resolveAudioLanguages(
  details: AudioLanguageDetails,
  input: string,
  metadata: any,
  signal: AbortSignal,
): Promise<AudioLanguageResolution> {
  const untouched: AudioLanguageResolution = { metadata, undetermined: [] };
  if (details.compressionEnabled === false) return untouched;
  const audio = audioStreamsOf(metadata);
  const before = findAudioCandidates(audio, details.allowedAudioLanguagesIso3, details.originalLanguageIso3, NO_AUDIO_VARIANTS);
  if (before.hasOriginal) return untouched;
  const candidates = untaggedCandidates(audio);
  if (candidates.length === 0) return untouched;

  const file = await fileIdentity(input).catch(() => null);
  const duration = Number(metadata?.format?.duration);
  const decided = new Map<number, string>();
  const undetermined: number[] = [];

  for (const stream of candidates) {
    try {
      const identity = file && { ...file, stream: stream.index, rev: DETECTOR_REVISION };
      let verdict = await readVerdict<Verdict>('audio-language', identity);
      if (verdict !== undefined) {
        const label = 'iso3' in verdict ? verdict.iso3 : 'undecided';
        console.log(`[language] stream ${stream.index} → ${label} (reused)`);
      } else {
        verdict = await detectStream(input, stream, duration, signal);
        await writeVerdict('audio-language', identity, verdict);
      }
      if ('iso3' in verdict) decided.set(stream.index, verdict.iso3);
      else undetermined.push(stream.index);
    } catch (error) {
      if (error instanceof EncodeCancelledError) throw error;
      console.log(`[language] stream ${stream.index} detection failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const relabelled = structuredClone(metadata);
  for (const s of audioStreamsOf(relabelled)) {
    const iso3 = decided.get(s.index);
    if (iso3 === undefined) continue;
    s.tags = { ...(s.tags ?? {}), language: iso3 };
  }

  // Spec 122, REQ-6
  const after = findAudioCandidates(
    audioStreamsOf(relabelled),
    details.allowedAudioLanguagesIso3,
    details.originalLanguageIso3,
    NO_AUDIO_VARIANTS,
  );
  if (!after.hasOriginal && undetermined.length > 0) {
    const params = { iso3: details.originalLanguageIso3 };
    throw new KeyedError(
      ERROR_ENCODE_ORIGINAL_AUDIO_UNDETERMINED,
      renderMessage(ERROR_ENCODE_ORIGINAL_AUDIO_UNDETERMINED, params),
      params,
    );
  }
  return { metadata: relabelled, undetermined };
}
