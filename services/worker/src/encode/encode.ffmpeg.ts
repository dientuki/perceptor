import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { EncodeFn } from './types';
import { getMetadata } from '../ffmpeg/metadata';
import { buildFfmpegCommand } from '../ffmpeg/buildCommand';
import { runFfmpeg } from '../ffmpeg/runner';

function toTempPath(output: string, suffix: string): string {
  // Mismo patrón que encode.mock.ts, con dos sufijos distintos porque acá hay
  // dos pasos intermedios (ffmpeg y mkvmerge) antes del nombre definitivo —
  // ver el comentario de secuencia de archivos en ffmpeg/runner.ts.
  return output.replace(/(\.[^./]+)$/, `.${suffix}$1`);
}

// Driver real: ffprobe para los metadatos, arma el comando de ffmpeg según
// los streams del archivo y los datos de la media, corre ffmpeg + mkvmerge.
// Sin escrituras a la base ni llamadas GraphQL acá — eso lo hace
// jobs/encode.job.ts con lo que este driver devuelve.
export const encodeFfmpeg: EncodeFn = async (input, output, details, onProgress) => {
  const workingPath = toTempPath(output, 'working');
  const remuxPath = toTempPath(output, 'remux');

  await mkdir(dirname(output), { recursive: true });

  const metadata = await getMetadata(input);

  // Con ENCODE_SAMPLE_SECONDS seteado sólo se encodean esos segundos (ver
  // buildFfmpegCommand), así que el progreso también se calcula contra ese
  // valor — contra la duración real, nunca llegaría a acercarse al 100%.
  const sampleSeconds = process.env.ENCODE_SAMPLE_SECONDS;
  const durationSeconds = sampleSeconds ? Number(sampleSeconds) : Number(metadata.format?.duration ?? 0);

  const args = buildFfmpegCommand(input, workingPath, metadata, details);
  const ffmpegCommand = await runFfmpeg(args, workingPath, remuxPath, output, durationSeconds, onProgress);

  return { ffmpegCommand };
};
