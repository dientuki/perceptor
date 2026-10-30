import { rm, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { EncodeCancelledError } from '../encode/cancellation';
import { runFfmpegCapture } from '../ffmpeg/capture';
import { ERROR_ENCODE_DISC_REMUX_FAILED } from '../i18n/error-keys';
import { KeyedError } from '../i18n/keyed-error';
import { fileIdentity, readVerdict, writeVerdict } from '../encode/verdict-store';

const STDERR_TAIL_CHARS = 2000;

// Spec 100, REQ-6
export function assembledPathFor(playlistPath: string): string {
  const discRoot = dirname(dirname(dirname(playlistPath)));
  return join(discRoot, `${basename(playlistPath).replace(/\.mpls$/i, '')}.perceptor.mkv`);
}

async function exists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

// Spec 100, REQ-6 REQ-10
export async function assemblePlaylist(playlistPath: string, signal: AbortSignal): Promise<string> {
  const outputPath = assembledPathFor(playlistPath);

  // Spec 111, REQ-6 REQ-7
  const identity = await fileIdentity(playlistPath);
  const verdictIdentity = identity === null ? null : { ...identity };
  const recorded = await readVerdict<{ size: number; mtimeMs: number }>('assembly', verdictIdentity);
  if (recorded) {
    try {
      const info = await stat(outputPath);
      if (info.isFile() && info.size === recorded.size && info.mtimeMs === recorded.mtimeMs) {
        console.log(`[disc] reused ${outputPath}`);
        return outputPath;
      }
    } catch {
      // missing output: assemble again
    }
  }

  await rm(outputPath, { force: true });

  let result;
  try {
    result = await runFfmpegCapture(['-o', outputPath, playlistPath], signal, {
      binary: 'mkvmerge',
      keepStdout: true,
    });
  } catch (err) {
    await rm(outputPath, { force: true });
    if (err instanceof EncodeCancelledError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new KeyedError(ERROR_ENCODE_DISC_REMUX_FAILED, `mkvmerge could not run: ${message}`, {
      code: -1,
      stderr: message.slice(-STDERR_TAIL_CHARS) || 'mkvmerge could not run',
    });
  }

  const code = result.code;
  if ((code === 0 || code === 1) && (await exists(outputPath))) {
    // Spec 111, REQ-6
    const info = await stat(outputPath);
    await writeVerdict('assembly', verdictIdentity, { size: info.size, mtimeMs: info.mtimeMs });
    return outputPath;
  }

  await rm(outputPath, { force: true });
  const combined = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  throw new KeyedError(ERROR_ENCODE_DISC_REMUX_FAILED, `mkvmerge failed with exit code ${code}`, {
    code: code ?? -1,
    stderr: (combined || 'no output from mkvmerge').slice(-STDERR_TAIL_CHARS),
  });
}
