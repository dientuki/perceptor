import { basename, dirname } from 'node:path';
import {
  computeBitsPerPixelPerFrame,
  isLosslessAudioStream,
  type RemuxMetadata,
} from '../ffmpeg/remux-detection';

export interface GrainGateResult {
  score: number;
  passed: boolean;
  reasons: string[];
}

// Spec 094, REQ-4
const GRAIN_GATE_PASS_SCORE = 2;
// Spec 094, REQ-4
const WEIGHT_ENCODER_TUNE_GRAIN = 3;
// Spec 094, REQ-4
const WEIGHT_ENCODER_FILM_GRAIN = 3;
// Spec 094, REQ-4
const WEIGHT_BPPPF_HIGH = 2;
// Spec 094, REQ-4
const WEIGHT_BPPPF_MID = 1;
// Spec 094, REQ-4
const WEIGHT_BPPPF_LOW = -2;
// Spec 094, REQ-4
const WEIGHT_LOSSLESS_AUDIO = 1;
// Spec 094, REQ-4
const WEIGHT_DISC_MARKER = 1;
// Spec 094, REQ-4
const WEIGHT_STREAMING_MARKER = -1;
// Spec 094, REQ-5
const WEIGHT_FILM_ERA_YEAR = 1;
// Spec 094, REQ-5
const FILM_ERA_BEFORE_YEAR = 2002;
// Spec 094, REQ-4
const BPPPF_HIGH_THRESHOLD = 0.2;
// Spec 094, REQ-4
const BPPPF_MID_THRESHOLD = 0.13;
// Spec 094, REQ-4
const BPPPF_LOW_THRESHOLD = 0.07;
// Spec 094, REQ-4
const CODEC_EFFICIENCY_FACTORS: Record<string, number> = {
  h264: 1.0,
  avc: 1.0,
  mpeg2video: 1.0,
  mpeg4: 1.0,
  vc1: 1.0,
  hevc: 1.8,
  h265: 1.8,
  vp9: 1.8,
  av1: 2.4,
};
// Spec 094, REQ-4
const DEFAULT_CODEC_EFFICIENCY_FACTOR = 1.0;
// Spec 094, REQ-4
const EXTRA_LOSSLESS_AUDIO_CODECS = new Set(['flac', 'alac']);
// Spec 094, REQ-4
const DISC_MARKER_PATTERN = /remux|bluray|blu-ray|bdrip|bd25|bd50|uhdbd/;
// Spec 094, REQ-4
const STREAMING_MARKER_PATTERN = /web-?dl|web-?rip|amzn|nf\.|dsnp|hmax|atvp|webdl/;
// Spec 094, REQ-4
const TUNE_GRAIN_PATTERN = /tune[=: ]+grain|--tune +grain/;
// Spec 094, REQ-4
const FILM_GRAIN_PATTERN = /film[-_]grain[=: ]+(\d+)/g;

function collectTagText(metadata: RemuxMetadata): string {
  const lines: string[] = [];
  const addTags = (tags: Record<string, unknown> | undefined) => {
    if (!tags) return;
    for (const [key, value] of Object.entries(tags)) {
      lines.push(`${key}=${String(value)}`);
    }
  };

  for (const stream of metadata.streams ?? []) addTags(stream.tags);
  addTags(metadata.format?.tags);

  return lines.join('\n').toLowerCase();
}

function codecEfficiencyFactor(codec: string | undefined): number {
  return CODEC_EFFICIENCY_FACTORS[(codec || '').toLowerCase()] ?? DEFAULT_CODEC_EFFICIENCY_FACTOR;
}

function hasLosslessAudio(metadata: RemuxMetadata): boolean {
  return (metadata.streams ?? [])
    .filter((s) => s.codec_type === 'audio')
    .some(
      (s) =>
        isLosslessAudioStream(s) ||
        EXTRA_LOSSLESS_AUDIO_CODECS.has((s.codec_name || '').toLowerCase()),
    );
}

export function scoreGrainGate(
  metadata: RemuxMetadata,
  inputPath: string,
  year: number | null,
): GrainGateResult {
  let score = 0;
  const reasons: string[] = [];
  const add = (points: number, reason: string) => {
    score += points;
    reasons.push(`${reason}: ${points > 0 ? '+' : ''}${points}`);
  };

  const tagText = collectTagText(metadata);
  const provenance = `${basename(dirname(inputPath))} ${basename(inputPath)}`.toLowerCase();

  if (TUNE_GRAIN_PATTERN.test(tagText)) add(WEIGHT_ENCODER_TUNE_GRAIN, 'encoder tune=grain');

  let filmGrain = 0;
  for (const match of tagText.matchAll(FILM_GRAIN_PATTERN)) {
    filmGrain = Math.max(filmGrain, Number(match[1]));
  }
  if (filmGrain > 0) add(WEIGHT_ENCODER_FILM_GRAIN, `encoder film-grain=${filmGrain}`);

  const videoStream = (metadata.streams ?? []).find((s) => s.codec_type === 'video');
  const rawBpppf = computeBitsPerPixelPerFrame(videoStream, metadata.format);
  if (rawBpppf !== null) {
    const normalized = rawBpppf * codecEfficiencyFactor(videoStream?.codec_name);
    const shown = normalized.toFixed(5);
    if (normalized >= BPPPF_HIGH_THRESHOLD) {
      add(WEIGHT_BPPPF_HIGH, `normalized bpppf ${shown} >= ${BPPPF_HIGH_THRESHOLD}`);
    } else if (normalized >= BPPPF_MID_THRESHOLD) {
      add(WEIGHT_BPPPF_MID, `normalized bpppf ${shown} >= ${BPPPF_MID_THRESHOLD}`);
    } else if (normalized < BPPPF_LOW_THRESHOLD) {
      add(WEIGHT_BPPPF_LOW, `normalized bpppf ${shown} < ${BPPPF_LOW_THRESHOLD}`);
    }
  }

  if (hasLosslessAudio(metadata)) add(WEIGHT_LOSSLESS_AUDIO, 'lossless audio present');
  if (DISC_MARKER_PATTERN.test(provenance)) add(WEIGHT_DISC_MARKER, 'disc source in path');
  if (STREAMING_MARKER_PATTERN.test(provenance)) {
    add(WEIGHT_STREAMING_MARKER, 'streaming source in path');
  }
  if (year !== null && year < FILM_ERA_BEFORE_YEAR) {
    add(WEIGHT_FILM_ERA_YEAR, `year ${year} before ${FILM_ERA_BEFORE_YEAR}`);
  }

  return { score, passed: score >= GRAIN_GATE_PASS_SCORE, reasons };
}
