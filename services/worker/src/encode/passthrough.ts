import { mkdir, rename, copyFile, chmod, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { EncodeFn } from './types';
import { KeyedError } from '../i18n/keyed-error';
import { renderMessage } from '../i18n/messages.en';
import { ERROR_ENCODE_MOVE_FAILED } from '../i18n/error-keys';
import { EncodeCancelledError } from './cancellation';

// 032-optional-compression's "compression off" driver: not an ENCODE_DRIVER
// (never registered in ./index.ts's DRIVERS — see ../plan.md's "Alternatives
// rejected"), called directly by jobs/encode.job.ts when
// details.compressionEnabled === false. Same EncodeFn shape as encode.mock.ts
// / encode.ffmpeg.ts so the job handler doesn't grow a second code path for
// "how a file lands at its destination" — it just picks a function.
//
// Moves the input file to output. Never runs ffprobe/ffmpeg/mkvmerge, never
// writes under the final name, and never leaves a partial file bearing the
// final name if anything goes wrong — same discipline as ffmpeg/runner.ts's
// .working/.part handling, applied to a plain move instead of an encode.
function toPartPath(output: string): string {
  return output.replace(/(\.[^./]+)$/, '.part$1');
}

async function removeIfExists(path: string): Promise<void> {
  await rm(path, { force: true });
}

export const passthrough: EncodeFn = async (input, output, _details, onProgress, _onProbe, signal) => {
  try {
    if (signal.aborted) {
      throw new EncodeCancelledError();
    }

    await mkdir(dirname(output), { recursive: true });

    try {
      await rename(input, output);
      // rename preserves the source's mode instead of respecting the
      // process umask(0o002) set in index.ts — same correction encode.mock.ts
      // applies after copyFile, for the same reason (a media server running
      // as another uid in the same group needs group-write to add sidecars).
      await chmod(output, 0o664);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== 'EXDEV') {
        throw err;
      }

      // Cross-device: rename() can't cross filesystems (downloads on one
      // disk, library on another is the normal deployment here — see
      // encode.ffmpeg.ts's own comment). Copy to a .part sibling of the
      // final destination, then an atomic same-filesystem rename, so no
      // half-copied multi-GB file is ever visible under the final name.
      const partPath = toPartPath(output);
      try {
        await copyFile(input, partPath);
        await chmod(partPath, 0o664);

        if (signal.aborted) {
          throw new EncodeCancelledError();
        }

        await rename(partPath, output);
      } catch (copyErr) {
        await removeIfExists(partPath);
        throw copyErr;
      }

      // Only unlink the source once the destination rename has actually
      // succeeded — otherwise a failure between copy and rename would lose
      // the file entirely.
      await removeIfExists(input);
    }

    // 100 only once the file is at its final name, exactly like
    // ffmpeg/runner.ts caps progress at 99 until its own final rename. null
    // speed: with compression off there is no FFmpeg and there is no speed
    // (REQ-11, 053-downloads-panel-repair) — the panel's Speed column must
    // stay empty rather than show a fabricated value.
    await onProgress(100, null);

    return { ffmpegCommand: '' };
  } catch (err) {
    if (err instanceof EncodeCancelledError) {
      throw err;
    }

    const detail = err instanceof Error ? err.message : String(err);
    const params = { detail };
    throw new KeyedError(
      ERROR_ENCODE_MOVE_FAILED,
      renderMessage(ERROR_ENCODE_MOVE_FAILED, params),
      params,
    );
  }
};
