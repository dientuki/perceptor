import { EncodeCancelledError } from './cancellation';
import { runFfmpegCapture } from '../ffmpeg/capture';
import { selectAudioStreams } from '../ffmpeg/params';
import { NO_AUDIO_VARIANTS, type AudioVariantResolution } from '../ffmpeg/variants';
import { fileIdentity, readVerdict, writeVerdict, type VerdictIdentity } from './verdict-store';

// Spec 099, REQ-6
export const STREAM_END_TRIM_WINDOW_SECONDS = 300;
// Spec 099, REQ-8
export const STREAM_END_TRIM_THRESHOLD_SECONDS = 2;

export interface StreamEndTrimDetails {
  streamEndTrimEnabled: boolean;
  originalLanguageIso3: string;
  allowedAudioLanguagesIso3: string[];
  allowedAudioLanguageTags?: string[];
}

export interface StreamEndDecision {
  video: number | undefined;
  audio: number | undefined;
  cut: number | null;
  outOfWindow: boolean;
}

// Spec 099, REQ-6
export function parsePacketEnds(stdout: string): Map<number, number> {
  const ends = new Map<number, number>();
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith('packet|')) continue;
    const fields = new Map<string, string>();
    for (const part of line.split('|').slice(1)) {
      const eq = part.indexOf('=');
      if (eq > 0) fields.set(part.slice(0, eq), part.slice(eq + 1));
    }
    const index = Number(fields.get('stream_index'));
    const pts = Number(fields.get('pts_time'));
    if (!Number.isInteger(index) || fields.get('pts_time') === undefined || !Number.isFinite(pts)) continue;
    const rawDuration = Number(fields.get('duration_time'));
    const duration = Number.isFinite(rawDuration) ? rawDuration : 0;
    const end = pts + duration;
    const previous = ends.get(index);
    if (previous === undefined || end > previous) ends.set(index, end);
  }
  return ends;
}

// Spec 099, REQ-8 REQ-9
export function decideStreamEndCut(
  videoEnd: number | undefined,
  audioEnds: (number | undefined)[],
): StreamEndDecision {
  const known = audioEnds.filter((end): end is number => end !== undefined);
  const audio = known.length > 0 ? Math.max(...known) : undefined;
  if (videoEnd === undefined || audioEnds.length === 0 || known.length !== audioEnds.length) {
    return { video: videoEnd, audio, cut: null, outOfWindow: true };
  }
  const cut = Math.abs(videoEnd - (audio as number)) > STREAM_END_TRIM_THRESHOLD_SECONDS
    ? Math.min(videoEnd, audio as number)
    : null;
  return { video: videoEnd, audio, cut, outOfWindow: false };
}

// Spec 099, REQ-5 REQ-6
export async function readTrackEnds(
  input: string,
  metadata: any,
  streamIndices: number[],
  signal: AbortSignal,
): Promise<Map<number, number>> {
  const duration = Number(metadata?.format?.duration);
  if (!Number.isFinite(duration)) throw new Error('no readable container duration');

  const from = Math.max(0, duration - STREAM_END_TRIM_WINDOW_SECONDS);
  const result = await runFfmpegCapture(
    [
      '-v',
      'error',
      '-read_intervals',
      `${from.toFixed(3)}%`,
      '-show_entries',
      'packet=stream_index,pts_time,duration_time',
      '-of',
      'compact',
      input,
    ],
    signal,
    { binary: 'ffprobe', keepStdout: true },
  );
  if (result.code !== 0) throw new Error(`ffprobe exited with ${result.code}`);

  const all = parsePacketEnds(result.stdout ?? '');
  const wanted = new Map<number, number>();
  for (const index of streamIndices) {
    const end = all.get(index);
    if (end !== undefined) wanted.set(index, end);
  }
  return wanted;
}

function show(value: number | undefined): string {
  return value === undefined ? 'n/a' : value.toFixed(3);
}

// Spec 099, REQ-3 REQ-7 REQ-13 NFR-1
export async function resolveStreamEndTrim(
  details: StreamEndTrimDetails,
  input: string,
  metadata: any,
  signal: AbortSignal,
  audioVariants: AudioVariantResolution = NO_AUDIO_VARIANTS,
): Promise<number | null> {
  if (!details.streamEndTrimEnabled) return null;

  try {
    const streams: any[] = Array.isArray(metadata?.streams) ? metadata.streams : [];
    const video = streams.find((s) => s?.codec_type === 'video');
    if (!video) throw new Error('no video stream');

    const { streams: kept } = selectAudioStreams(
      streams.filter((s) => s?.codec_type === 'audio'),
      details.allowedAudioLanguagesIso3,
      details.originalLanguageIso3,
      details.allowedAudioLanguageTags ?? [],
      audioVariants,
    );
    if (kept.length === 0) throw new Error('no kept audio stream');

    // Spec 111, REQ-2
    const file = await fileIdentity(input);
    const identity: VerdictIdentity = file
      ? { ...file, video: video.index, audio: kept.map((s) => s.index as number).sort((a, b) => a - b) }
      : null;
    const stored = await readVerdict<number | null>('streamtrim', identity);
    if (stored !== undefined) {
      console.log(
        `[streamtrim] input=${input} -> ${stored === null ? 'keep' : `cut=${stored.toFixed(3)}`} (reused)`,
      );
      return stored;
    }

    const ends = await readTrackEnds(input, metadata, [video.index, ...kept.map((s) => s.index)], signal);
    const decision = decideStreamEndCut(
      ends.get(video.index),
      kept.map((s) => ends.get(s.index)),
    );
    // A cut at or below zero would produce an empty file; treat it as keep.
    const cut = decision.cut !== null && decision.cut > 0 ? decision.cut : null;

    console.log(
      `[streamtrim] input=${input} video=${show(decision.video)} audio=${show(decision.audio)} -> ` +
        (decision.outOfWindow ? 'keep (out of window)' : cut === null ? 'keep' : `cut=${cut.toFixed(3)}`),
    );
    // Spec 111, REQ-2
    await writeVerdict('streamtrim', identity, cut);
    return cut;
  } catch (error) {
    if (error instanceof EncodeCancelledError) throw error;
    return null;
  }
}
