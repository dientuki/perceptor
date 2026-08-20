// src/core/ffmpeg/metadata.ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { KeyedError } from '../i18n/keyed-error';
import { renderMessage } from '../i18n/messages.en';
import { ERROR_ENCODE_PROBE_FAILED } from '../i18n/error-keys';

const execFileAsync = promisify(execFile);

export async function getMetadata(filePath: string) {
  try {
    // execFile, no exec: pasa filePath como argumento del proceso hijo en vez
    // de interpolarlo en una string de shell. Nombres de release derivados de
    // torrents pueden traer comillas, backticks o $(...) — con exec (que corre
    // vía /bin/sh -c) eso es inyección de shell; con execFile no hay shell de
    // por medio, así que no hace falta escapar nada.
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_format',
      '-show_streams',
      '-of', 'json',
      filePath,
    ]);
    return JSON.parse(stdout);
  } catch (error) {
    console.error(`[ffmpeg] error en ffprobe al analizar ${filePath}:`, error);
    // Se propaga la causa real (antes se perdía en un mensaje genérico) — el
    // caller (encode.ffmpeg.ts) la reporta tal cual vía encodeFailed.
    const params = {
      filePath,
      detail: error instanceof Error ? error.message : String(error),
    };
    throw new KeyedError(
      ERROR_ENCODE_PROBE_FAILED,
      renderMessage(ERROR_ENCODE_PROBE_FAILED, params),
      params,
    );
  }
}
