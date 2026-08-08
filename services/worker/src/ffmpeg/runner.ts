import { spawn } from 'node:child_process';
import { rm, rename, stat } from 'node:fs/promises';

// Cuántas líneas de stderr de ffmpeg se guardan para el errorMessage que
// termina en encodeFailed — sin esto un fallo de encode no dice nada útil.
const STDERR_TAIL_LINES = 40;

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function runMkvmerge(remuxPath: string, workingPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const merge = spawn('mkvmerge', ['-o', remuxPath, workingPath]);
    let stderr = '';
    merge.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    merge.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`mkvmerge falló con código ${code}: ${stderr.trim().slice(-500)}`));
      }
    });
    merge.on('error', reject);
  });
}

// Corre ffmpeg y, si termina bien, remuxea con mkvmerge para corregir
// metadatos del contenedor antes de dejar el archivo en su ruta final.
//
// Secuencia de archivos, ninguno escrito directo sobre `output`:
//   ffmpeg   -> workingPath (<final>.working.mkv)
//   mkvmerge -> remuxPath   (<final>.remux.mkv)
//   rename   -> output      (atómico dentro del mismo filesystem)
// Antes mkvmerge escribía directo sobre el nombre final: si lo mataban a
// mitad de camino (SIGKILL, disco lleno, corte de luz), Jellyfin podía
// encontrar un archivo con nombre definitivo pero contenido truncado.
//
// `durationSeconds` es el denominador para calcular el progreso a partir de
// out_time_us (ver -progress pipe:1 en buildCommand.ts) — con
// ENCODE_SAMPLE_SECONDS seteado es ese valor, no la duración real del archivo.
export function runFfmpeg(
  args: string[],
  workingPath: string,
  remuxPath: string,
  output: string,
  durationSeconds: number,
  onProgress: (progress: number) => Promise<void>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const finalCmd = `ffmpeg ${args.map((arg) => (arg.includes(' ') ? `"${arg}"` : arg)).join(' ')}`;
    console.log(`[ffmpeg] ejecutando: ${finalCmd}`);

    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    const stderrTail: string[] = [];
    let progressInFlight = false;
    let settled = false;

    const cleanupTemps = async () => {
      await rm(workingPath, { force: true }).catch(() => {});
      await rm(remuxPath, { force: true }).catch(() => {});
    };

    // Docker manda SIGTERM en `docker compose stop`/restart, no SIGINT — el
    // runner viejo sólo escuchaba SIGINT, así que un stop dejaba el ffmpeg
    // huérfano. ffmpeg maneja SIGTERM igual que SIGINT (para el loop principal
    // y cierra el archivo de forma prolija); el 'close' que dispara después
    // limpia los temporales por el camino normal de error (code !== 0).
    const killHandler = () => {
      if (!child.killed) {
        console.log('[ffmpeg] señal de cierre recibida, matando el proceso...');
        child.kill('SIGTERM');
      }
    };

    process.once('SIGINT', killHandler);
    process.once('SIGTERM', killHandler);
    // Último recurso si el proceso se cae sin pasar por SIGINT/SIGTERM (p. ej.
    // una excepción no capturada en otro punto del worker): sólo mata al hijo,
    // sin tocar el filesystem — 'exit' no puede esperar operaciones async.
    process.once('exit', () => {
      if (!child.killed) child.kill('SIGKILL');
    });

    function cleanupListeners() {
      process.removeListener('SIGINT', killHandler);
      process.removeListener('SIGTERM', killHandler);
    }

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      cleanupListeners();
      cleanupTemps().finally(() => reject(err));
    });

    // out_time_us= llega en microsegundos y viene en 'N/A' durante el
    // buffering inicial de encoders como SVT-AV1 — hay que saltearlo, no
    // tratarlo como progreso 0. onProgress es async pero el stream 'data' no
    // tiene backpressure para esperarlo ahí mismo: se serializa con
    // progressInFlight ("hay uno en vuelo, descarto este") en vez de await,
    // así nunca hay dos mutations de progreso concurrentes sobre el mismo
    // ProcessJob — es la misma condición que ya rompió con error 1020 de
    // MariaDB en encode.mock.ts/encode.job.ts.
    child.stdout.on('data', (data: Buffer) => {
      const match = data.toString().match(/out_time_us=(\d+)/);
      if (!match || progressInFlight || durationSeconds <= 0) return;

      const outTimeSeconds = Number(match[1]) / 1_000_000;
      if (!Number.isFinite(outTimeSeconds)) return;

      // Tope en 99: el 100 lo pone encodeCompleted recién después del rename
      // final, cuando el archivo ya está de verdad en su ruta definitiva.
      const progress = Math.min(99, Math.max(0, Math.round((outTimeSeconds / durationSeconds) * 100)));
      progressInFlight = true;
      onProgress(progress)
        .catch((err) => console.error('[ffmpeg] no se pudo reportar progreso:', err))
        .finally(() => {
          progressInFlight = false;
        });
    });

    child.stderr.on('data', (data: Buffer) => {
      const line = data.toString().trim();
      if (!line) return;
      stderrTail.push(line);
      if (stderrTail.length > STDERR_TAIL_LINES) stderrTail.shift();
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      cleanupListeners();
      void handleClose(code);
    });

    async function handleClose(code: number | null) {
      if (code !== 0) {
        await cleanupTemps();
        reject(new Error(`ffmpeg terminó con código ${code}: ${stderrTail.slice(-10).join(' | ')}`));
        return;
      }

      // El bug que colgaba el worker para siempre estaba acá: si code===0 pero
      // el temporal no existe, el código viejo no llamaba ni resolve() ni
      // reject() — con concurrency 1 eso ocupaba el worker de encode
      // indefinidamente. Ahora siempre se resuelve uno de los dos caminos.
      if (!(await exists(workingPath))) {
        reject(new Error(`ffmpeg terminó con código 0 pero no generó ${workingPath}`));
        return;
      }

      try {
        console.log('[ffmpeg] muxing con mkvmerge para corregir metadatos...');
        await runMkvmerge(remuxPath, workingPath);
        await rm(workingPath, { force: true });
        await rename(remuxPath, output);
        console.log(`[ffmpeg] completado -> ${output}`);
        resolve(finalCmd);
      } catch (err) {
        await cleanupTemps();
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    }
  });
}
