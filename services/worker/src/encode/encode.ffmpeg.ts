import { dirname, join, basename, extname } from 'node:path';
import type { EncodeFn } from './types';
import { getMetadata } from '../ffmpeg/metadata';
import { buildFfmpegCommand } from '../ffmpeg/buildCommand';
import { runFfmpeg } from '../ffmpeg/runner';
import { isVulkanAvailable } from '../ffmpeg/vulkan';

// El origen y el destino suelen estar en discos distintos (descargas en un
// SSD/NVMe, biblioteca en uno mecánico, a veces ni el mismo filesystem). El
// temporal de ffmpeg va junto al ORIGEN a propósito: el encode dura horas y
// no tiene sentido pagar la latencia del disco lento durante todo ese tiempo
// — sólo se toca el destino una vez, al final, con el remux de mkvmerge (ver
// ffmpeg/runner.ts). No sirve un replace sobre el input como se hacía antes
// con el output: la salida siempre es .mkv aunque el origen sea .mp4/.avi/etc.
function toWorkingPath(input: string): string {
  const name = basename(input, extname(input));
  return join(dirname(input), `${name}.working.mkv`);
}

function toPartPath(output: string): string {
  return output.replace(/(\.[^./]+)$/, '.part$1');
}

// Driver real: ffprobe para los metadatos, arma el comando de ffmpeg según
// los streams del archivo y los datos de la media, corre ffmpeg + mkvmerge.
// Sin escrituras a la base ni llamadas GraphQL acá — eso lo hace
// jobs/encode.job.ts con lo que este driver devuelve.
export const encodeFfmpeg: EncodeFn = async (input, output, details, onProgress, onProbe) => {
  const workingPath = toWorkingPath(input);
  const partPath = toPartPath(output);

  // La carpeta de destino se crea en runner.ts, recién antes del remux con
  // mkvmerge — no acá. El encode puede tardar horas; crearla ya en este punto
  // deja una carpeta vacía visible en la biblioteca (y al media server) todo
  // ese tiempo, fingiendo contenido que todavía no existe.
  const { metadata, raw } = await getMetadata(input);

  // Recorded before the command is built, and awaited: a container killed
  // mid-encode must still leave the probe on record (REQ-1, 023-ffprobe-log).
  await onProbe(input, raw);

  // Con ENCODE_SAMPLE_SECONDS seteado sólo se encodean esos segundos (ver
  // buildFfmpegCommand), así que el progreso también se calcula contra ese
  // valor — contra la duración real, nunca llegaría a acercarse al 100%.
  const sampleSeconds = process.env.ENCODE_SAMPLE_SECONDS;
  const durationSeconds = sampleSeconds ? Number(sampleSeconds) : Number(metadata.format?.duration ?? 0);

  // isVulkanAvailable() reads the memo populated by the startup probe
  // (src/index.ts) — this is the only place in the service that reads it;
  // buildFfmpegCommand takes it as an argument rather than reading the memo
  // itself, so its spec can drive both paths without stubbing a module.
  const args = buildFfmpegCommand(input, workingPath, metadata, details, isVulkanAvailable());
  const ffmpegCommand = await runFfmpeg(args, workingPath, partPath, output, durationSeconds, onProgress);

  return { ffmpegCommand };
};
