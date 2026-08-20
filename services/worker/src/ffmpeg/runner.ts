import { spawn, ChildProcess } from 'node:child_process';
import { mkdir, rm, rename, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { KeyedError } from '../i18n/keyed-error';
import { renderMessage } from '../i18n/messages.en';
import {
  ERROR_ENCODE_FFMPEG_FAILED,
  ERROR_ENCODE_MKVMERGE_FAILED,
  ERROR_ENCODE_NO_OUTPUT,
} from '../i18n/error-keys';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

// Corre ffmpeg y, si termina bien, remuxea con mkvmerge para corregir
// metadatos del contenedor — mkvmerge escribe DIRECTO al destino final.
//
// Secuencia de archivos:
//   ffmpeg   -> workingPath (junto al ORIGEN: <input>.working.mkv, ver
//               encode.ffmpeg.ts) — el encode dura horas, no tiene sentido
//               pagar la latencia de un disco de biblioteca lento durante
//               todo ese tiempo.
//   mkvmerge -> partPath    (<final>.part.mkv, en el DESTINO) — igual lee el
//               archivo entero y lo vuelve a escribir, así que hace de remux
//               y de "copiar al destino" en una sola pasada.
//   rename   -> output      (atómico: partPath y output son hermanos en el
//               mismo filesystem de destino, así que nunca cruza dispositivos)
// Ninguno de los dos pasos escribe nunca directo sobre `output`: si se corta
// a mitad de camino (SIGKILL, disco lleno, corte de luz), Jellyfin no puede
// encontrar un archivo con nombre definitivo pero contenido truncado.
//
// `durationSeconds` es el denominador para calcular el progreso a partir de
// out_time_us (ver -progress pipe:1 en buildCommand.ts) — con
// ENCODE_SAMPLE_SECONDS seteado es ese valor, no la duración real del archivo.
export function runFfmpeg(
  args: string[],
  workingPath: string,
  partPath: string,
  output: string,
  durationSeconds: number,
  onProgress: (progress: number) => Promise<void>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const finalCmd = `ffmpeg ${args.map((arg) => (arg.includes(' ') ? `"${arg}"` : arg)).join(' ')}`;
    console.log(`[ffmpeg] ejecutando: ${finalCmd}`);

    const stderrTail: string[] = [];
    let progressInFlight = false;
    let settled = false;

    // Apunta al proceso que esté corriendo en cada momento (primero ffmpeg,
    // después mkvmerge): así una señal de cierre llega al que corresponda sin
    // importar en qué paso esté el job. El bug viejo sólo mataba a ffmpeg —
    // durante todo el remux (ahora potencialmente varios minutos, escribiendo
    // a un disco lento) no había ningún proceso registrado para matar.
    let activeChild: ChildProcess | null = null;

    const cleanupTemps = async () => {
      // Los dos temporales viven en discos distintos (origen y destino): un
      // .part.mkv huérfano en la biblioteca puede pesar varios GB, así que
      // limpiarlo acá importa tanto como limpiar el .working.mkv del origen.
      await rm(workingPath, { force: true }).catch(() => {});
      await rm(partPath, { force: true }).catch(() => {});
    };

    // Docker manda SIGTERM en `docker compose stop`/restart, no SIGINT — el
    // runner viejo sólo escuchaba SIGINT, así que un stop dejaba el proceso
    // huérfano. ffmpeg y mkvmerge manejan SIGTERM igual que SIGINT.
    const killHandler = () => {
      if (activeChild && !activeChild.killed) {
        console.log('[ffmpeg] señal de cierre recibida, matando el proceso activo...');
        activeChild.kill('SIGTERM');
      }
    };

    process.once('SIGINT', killHandler);
    process.once('SIGTERM', killHandler);
    // Último recurso si el proceso se cae sin pasar por SIGINT/SIGTERM (p. ej.
    // una excepción no capturada en otro punto del worker): sólo mata al hijo
    // activo, sin tocar el filesystem — 'exit' no puede esperar operaciones async.
    process.once('exit', () => {
      if (activeChild && !activeChild.killed) activeChild.kill('SIGKILL');
    });

    // Se llama recién al final real del trabajo (éxito o fallo, tras ffmpeg
    // Y tras mkvmerge) — no en el close de ffmpeg, que es lo que dejaba el
    // remux sin ningún handler de señales registrado.
    function cleanupListeners() {
      process.removeListener('SIGINT', killHandler);
      process.removeListener('SIGTERM', killHandler);
    }

    function settleReject(err: Error) {
      if (settled) return;
      settled = true;
      cleanupListeners();
      cleanupTemps().finally(() => reject(err));
    }

    function settleResolve() {
      if (settled) return;
      settled = true;
      cleanupListeners();
      resolve(finalCmd);
    }

    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    activeChild = child;

    child.on('error', (err) => settleReject(err));

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
      void handleFfmpegClose(code);
    });

    async function handleFfmpegClose(code: number | null) {
      if (code !== 0) {
        // stderr is a param, not part of the sentence — this tail is what
        // reaches encodeFailed's errorParams, kept exactly as before.
        const params = { code: code ?? 0, stderr: stderrTail.slice(-10).join(' | ') };
        settleReject(
          new KeyedError(
            ERROR_ENCODE_FFMPEG_FAILED,
            renderMessage(ERROR_ENCODE_FFMPEG_FAILED, params),
            params,
          ),
        );
        return;
      }

      // El bug que colgaba el worker para siempre estaba acá: si code===0 pero
      // el temporal no existe, el código viejo no llamaba ni resolve() ni
      // reject() — con concurrency 1 eso ocupaba el worker de encode
      // indefinidamente. Ahora siempre se resuelve uno de los dos caminos.
      if (!(await exists(workingPath))) {
        const params = { path: workingPath };
        settleReject(
          new KeyedError(
            ERROR_ENCODE_NO_OUTPUT,
            renderMessage(ERROR_ENCODE_NO_OUTPUT, params),
            params,
          ),
        );
        return;
      }

      // De acá en más el trabajo pesado ya no es CPU, es I/O contra el disco
      // de destino: si es el disco lento de la biblioteca, este paso puede
      // tardar varios minutos por sí solo (progreso clavado en 99% mientras
      // tanto) — por eso importa que activeChild siga apuntando a algo vivo.
      console.log(`[ffmpeg] muxing con mkvmerge hacia el destino (${partPath})...`);

      try {
        // La carpeta de destino se crea recién acá, justo antes del primer
        // byte que se escribe ahí — no al arrancar el encode (que puede durar
        // horas). Así nadie mirando la biblioteca ve una carpeta vacía
        // fingiendo contenido que todavía no existe.
        await mkdir(dirname(partPath), { recursive: true });
        // Margen defensivo para destinos de red (NFS/SMB): un mkdir que ya
        // resolvió puede tardar un instante en propagarse antes de que otro
        // proceso (mkvmerge) la vea — barato comparado con las horas que ya
        // llevó el encode.
        await sleep(1000);
      } catch (err) {
        settleReject(err instanceof Error ? err : new Error(String(err)));
        return;
      }

      const merge = spawn('mkvmerge', ['-o', partPath, workingPath]);
      activeChild = merge;

      let mergeStderr = '';
      merge.stderr.on('data', (data: Buffer) => {
        mergeStderr += data.toString();
      });

      merge.on('error', (err) => settleReject(err));

      merge.on('close', (mergeCode) => {
        if (settled) return;
        void handleMergeClose(mergeCode, mergeStderr);
      });
    }

    async function handleMergeClose(mergeCode: number | null, mergeStderr: string) {
      if (mergeCode !== 0) {
        const params = { code: mergeCode ?? 0, stderr: mergeStderr.trim().slice(-500) };
        settleReject(
          new KeyedError(
            ERROR_ENCODE_MKVMERGE_FAILED,
            renderMessage(ERROR_ENCODE_MKVMERGE_FAILED, params),
            params,
          ),
        );
        return;
      }

      try {
        await rm(workingPath, { force: true });
        await rename(partPath, output);
        console.log(`[ffmpeg] completado -> ${output}`);
        settleResolve();
      } catch (err) {
        settleReject(err instanceof Error ? err : new Error(String(err)));
      }
    }
  });
}
