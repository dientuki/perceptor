import { dirname, join, basename, extname } from 'node:path';
import type { EncodeFn } from './types';
import { getMetadata } from '../ffmpeg/metadata';
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
  const durationSeconds = sampleSeconds ? Number(sampleSeconds) : Number(metadata.format?.duration ?? 0);

  const args = buildFfmpegCommand(input, workingPath, metadata, details);
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
