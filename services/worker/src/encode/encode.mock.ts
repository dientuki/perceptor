import { mkdir, copyFile, chmod, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { EncodeFn } from './types';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toWorkingPath(output: string): string {
  // Mismo patrón que va a usar el driver de ffmpeg real (ver services/worker/src/ffmpeg/runner.ts):
  // nunca se escribe directo sobre el destino final. Si se corta la luz a
  // mitad de camino, Jellyfin nunca ve un archivo truncado — sólo existe una
  // vez que el rename (atómico dentro del mismo filesystem) lo deja con su
  // nombre definitivo.
  return output.replace(/(\.[^./]+)$/, '.working$1');
}

const STEPS = 10;

// Reemplaza a FFmpeg mientras se porta services/worker/src/ffmpeg/ (imports
// del repo viejo que no compilan acá, y bugs propios — ver el plan): copia el
// archivo real y simula el tiempo/progreso de un encode, para poder probar el
// resto del pipeline (mover a la biblioteca, borrar el torrent, avisar al
// media server) contra datos de verdad. Se elige con ENCODE_DRIVER=mock
// (default) en src/encode/index.ts.
export const encodeMock: EncodeFn = async (input, output, _details, onProgress, _onProbe) => {
  const workingPath = toWorkingPath(output);
  await mkdir(dirname(output), { recursive: true });
  await copyFile(input, workingPath);
  // copyFile preserva el modo del archivo origen en vez de respetar el umask
  // del proceso (a diferencia de mkdir/writeFile) — con un source suelto de
  // pruebas eso puede dejar el resultado en 644 en vez de 664, distinto de lo
  // que produciría ffmpeg (un proceso hijo que sí hereda el umask del padre,
  // ver process.umask() en index.ts). Se fuerza acá para que el mock no
  // esconda un problema de permisos ni lo invente donde no lo hay.
  await chmod(workingPath, 0o664);

  const totalMs = Number(process.env.ENCODE_MOCK_SECONDS ?? 5) * 1000;
  for (let step = 1; step <= STEPS; step++) {
    await sleep(totalMs / STEPS);
    // await, no fire-and-forget: serializa los reportes de progreso para que
    // ninguno pueda seguir en vuelo cuando el caller dispare encodeCompleted
    // (ver comentario en encode.job.ts sobre el error 1020 de MariaDB).
    await onProgress(Math.round((step / STEPS) * 100));
  }

  // Comentado a propósito mientras se prueba el workflow a mano: el rename es
  // justo el paso que deja el archivo con su nombre definitivo en la
  // biblioteca real (DESTINATIONS_DIR), y correr el mock varias veces seguidas
  // ahí es fácil de confundir con una biblioteca real. El .working.mkv queda
  // en destino (visible, sin ensuciar el nombre final) hasta que se
  // descomente para probar el paso completo.
  // await rename(workingPath, output);

  return { ffmpegCommand: `[mock] cp "${input}" "${output}"` };
};
