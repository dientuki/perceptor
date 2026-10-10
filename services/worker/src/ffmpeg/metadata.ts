// src/core/ffmpeg/metadata.ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { KeyedError } from '../i18n/keyed-error';
import { renderMessage } from '../i18n/messages.en';
import { ERROR_ENCODE_PROBE_FAILED } from '../i18n/error-keys';

const execFileAsync = promisify(execFile);

export async function getMetadata(filePath: string) {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_format',
      '-show_streams',
      '-of', 'json',
      filePath,
    ]);
    // `raw` is the untouched ffprobe stdout, never re-serialized — a
    // JSON.stringify of the parsed value would reorder keys and reformat
    // numbers, which is exactly what the caller must not send onward.
    return { metadata: JSON.parse(stdout), raw: stdout };
  } catch (error) {
    console.error(`[ffmpeg] error en ffprobe al analizar ${filePath}:`, error);
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
