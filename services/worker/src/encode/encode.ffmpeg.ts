import { dirname, join, basename, extname } from 'node:path';
import type { EncodeFn } from './types';
import { getMetadata } from '../ffmpeg/metadata';
import { resolveFilmGrain } from './grain-mode';
import { resolveDubTrim } from './dub-trim';
import { resolveStreamEndTrim } from './stream-end-trim';
import { resolveSubtitlePruning } from './subtitle-prune';
import { buildFfmpegCommand } from '../ffmpeg/buildCommand';
import { runFfmpeg } from '../ffmpeg/runner';

function toWorkingPath(input: string): string {
  const name = basename(input, extname(input));
  return join(dirname(input), `${name}.working.mkv`);
}

function toPartPath(output: string): string {
  return output.replace(/(\.[^./]+)$/, '.part$1');
}

export const encodeFfmpeg: EncodeFn = async (input, output, details, onProgress, onProbe, signal) => {
  const workingPath = toWorkingPath(input);
  const partPath = toPartPath(output);

  const { metadata, raw } = await getMetadata(input);

  // Spec 023, REQ-1
  await onProbe(input, raw);

  const sampleSeconds = process.env.ENCODE_SAMPLE_SECONDS;
  const sourceDuration = Number(metadata.format?.duration ?? 0);
  const sample = sampleSeconds ? Number(sampleSeconds) : NaN;

  // Spec 092, REQ-9; Spec 094, REQ-3 NFR-1
  const filmGrain = await resolveFilmGrain(details, input, metadata, signal);
  // Spec 098, REQ-3; Spec 099, REQ-10
  const dubCut = await resolveDubTrim(details, input, metadata, signal);
  const endCut = await resolveStreamEndTrim(details, input, metadata, signal);
  // Spec 102, REQ-1
  const prunedSubtitles = await resolveSubtitlePruning(details, input, metadata, signal);
  const cuts = [dubCut, endCut].filter((c): c is number => c !== null);
  const trimAt = cuts.length > 0 ? Math.min(...cuts) : null;
  const args = buildFfmpegCommand(input, workingPath, metadata, details, filmGrain, trimAt, prunedSubtitles);
  // Spec 098, REQ-10
  const candidates = [sourceDuration];
  if (Number.isFinite(sample) && sample > 0) candidates.push(sample);
  if (trimAt !== null) candidates.push(trimAt);
  const valid = candidates.filter((n) => Number.isFinite(n) && n > 0);
  const durationSeconds = valid.length > 0 ? Math.min(...valid) : 0;
  const ffmpegCommand = await runFfmpeg(
    args,
    workingPath,
    partPath,
    output,
    durationSeconds,
    onProgress,
    signal,
  );

  return { ffmpegCommand };
};
