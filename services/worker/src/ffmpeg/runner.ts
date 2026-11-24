import { spawn, ChildProcess } from 'node:child_process';
import { mkdir, rm, rename, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { KeyedError } from '../i18n/keyed-error';
import { renderMessage } from '../i18n/messages.en';
import {
  ERROR_ENCODE_FFMPEG_FAILED,
  ERROR_ENCODE_MKVMERGE_FAILED,
  ERROR_ENCODE_NO_OUTPUT,
} from '../i18n/error-keys';
import { EncodeCancelledError } from '../encode/cancellation';

// Grace period between SIGTERM and SIGKILL for a cancelled encode's active
// child (whichever of ffmpeg/mkvmerge is running right now) — long enough
// for either to flush and exit cleanly on its own.
export const ABORT_KILL_GRACE_MS = 10_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const STDERR_TAIL_LINES = 40;

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// Spec 123, REQ-4 REQ-5
export function buildMergeArgs(
  partPath: string,
  workingPath: string,
  globalTagsPath: string | null,
  videoTags: { tid: number; path: string } | null,
): string[] {
  const args = ['-o', partPath, '--no-global-tags'];
  if (globalTagsPath !== null) args.push('--global-tags', globalTagsPath);
  if (videoTags !== null) args.push('--tags', `${videoTags.tid}:${videoTags.path}`);
  args.push(workingPath);
  return args;
}

export function parseFirstVideoTrackId(json: string): number | null {
  const parsed = JSON.parse(json) as { tracks?: { id: number; type: string }[] };
  const track = parsed.tracks?.find((t) => t.type === 'video');
  return track && Number.isInteger(track.id) ? track.id : null;
}

function firstVideoTrackId(path: string): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const probe = spawn('mkvmerge', ['-J', path]);
    let out = '';
    probe.stdout.on('data', (data: Buffer) => {
      out += data.toString();
    });
    probe.on('error', reject);
    probe.on('close', (code) => {
      if (code !== 0 && code !== 1) {
        reject(new Error(`mkvmerge -J exited ${code}`));
        return;
      }
      try {
        resolve(parseFirstVideoTrackId(out));
      } catch (err) {
        reject(err);
      }
    });
  });
}

export function runFfmpeg(
  args: string[],
  workingPath: string,
  partPath: string,
  output: string,
  durationSeconds: number,
  onProgress: (progress: number, speed: number | null) => Promise<void>,
  signal: AbortSignal,
  tags?: () => Promise<{ global: string | null; video: string | null } | null>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const finalCmd = `ffmpeg ${args.map((arg) => (arg.includes(' ') ? `"${arg}"` : arg)).join(' ')}`;
    console.log(`[ffmpeg] ejecutando: ${finalCmd}`);

    const stderrTail: string[] = [];
    let progressInFlight = false;
    // Spec 053, AC-8
    let lastSpeed: number | null = null;
    let settled = false;
    // Set the moment the abort listener below fires, so the close handlers
    // of whichever child (ffmpeg or mkvmerge) is running reject with
    // EncodeCancelledError instead of reading the SIGTERM/SIGKILL exit code
    // as a genuine ffmpeg/mkvmerge failure.
    let cancelled = false;
    let killTimer: NodeJS.Timeout | null = null;

    let activeChild: ChildProcess | null = null;

    const tagsPath = `${partPath}.tags.xml`;
    const videoTagsPath = `${partPath}.video-tags.xml`;

    const cleanupTemps = async () => {
      await rm(tagsPath, { force: true }).catch(() => {});
      await rm(videoTagsPath, { force: true }).catch(() => {});
      await rm(workingPath, { force: true }).catch(() => {});
      await rm(partPath, { force: true }).catch(() => {});
    };

    const killHandler = () => {
      if (activeChild && !activeChild.killed) {
        console.log('[ffmpeg] shutdown signal received, killing the active process...');
        activeChild.kill('SIGTERM');
      }
    };

    process.once('SIGINT', killHandler);
    process.once('SIGTERM', killHandler);
    process.once('exit', () => {
      if (activeChild && !activeChild.killed) activeChild.kill('SIGKILL');
    });

    function cleanupListeners() {
      process.removeListener('SIGINT', killHandler);
      process.removeListener('SIGTERM', killHandler);
      signal.removeEventListener('abort', abortHandler);
      if (killTimer) {
        clearTimeout(killTimer);
        killTimer = null;
      }
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

    // Spec 047, REQ-4
    function abortHandler() {
      cancelled = true;
      if (activeChild && !activeChild.killed) {
        console.log('[ffmpeg] cancellation received, killing the active process...');
        activeChild.kill('SIGTERM');
        killTimer = setTimeout(() => {
          if (activeChild && !activeChild.killed) {
            activeChild.kill('SIGKILL');
          }
        }, ABORT_KILL_GRACE_MS);
      }
    }

    if (signal.aborted) {
      settleReject(new EncodeCancelledError());
      return;
    }

    signal.addEventListener('abort', abortHandler);

    // Spec 054, REQ-6
    cleanupTemps().then(startFfmpeg);

    function startFfmpeg() {
      // The cleanup above spans an async gap — a cancellation (or another
      // exit path) may already have settled this promise while it ran.
      if (settled) return;
      if (cancelled) {
        settleReject(new EncodeCancelledError());
        return;
      }

      const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      activeChild = child;

      child.on('error', (err) => settleReject(err));

      child.stdout.on('data', (data: Buffer) => {
        const chunk = data.toString();

        // Spec 053, AC-8
        const speedMatch = chunk.match(/speed=\s*([\d.]+)x/);
        if (speedMatch) {
          const parsedSpeed = Number(speedMatch[1]);
          lastSpeed = Number.isFinite(parsedSpeed) ? parsedSpeed : null;
        } else if (chunk.includes('speed=N/A')) {
          lastSpeed = null;
        }

        const match = chunk.match(/out_time_us=(\d+)/);
        if (!match || progressInFlight || durationSeconds <= 0) return;

        const outTimeSeconds = Number(match[1]) / 1_000_000;
        if (!Number.isFinite(outTimeSeconds)) return;

        const progress = Math.min(99, Math.max(0, Math.round((outTimeSeconds / durationSeconds) * 100)));
        progressInFlight = true;
        onProgress(progress, lastSpeed)
          .catch((err) => console.error('[ffmpeg] could not report progress:', err))
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
    }

    async function handleFfmpegClose(code: number | null) {
      if (cancelled) {
        settleReject(new EncodeCancelledError());
        return;
      }

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

      console.log(`[ffmpeg] muxing with mkvmerge to the destination (${partPath})...`);

      try {
        await mkdir(dirname(partPath), { recursive: true });
        await sleep(1000);
      } catch (err) {
        settleReject(err instanceof Error ? err : new Error(String(err)));
        return;
      }

      if (cancelled) {
        settleReject(new EncodeCancelledError());
        return;
      }

      let hasGlobalTags = false;
      let videoTid: number | null = null;
      if (tags) {
        try {
          const produced = await tags();
          if (produced?.global != null) {
            try {
              await writeFile(tagsPath, produced.global);
              hasGlobalTags = true;
            } catch (err) {
              console.warn('[ffmpeg] global tags omitted:', err instanceof Error ? err.message : err);
            }
          }
          if (produced?.video != null) {
            try {
              const tid = await firstVideoTrackId(workingPath);
              if (tid === null) throw new Error('no video track id');
              await writeFile(videoTagsPath, produced.video);
              videoTid = tid;
            } catch (err) {
              console.warn('[ffmpeg] video tags omitted:', err instanceof Error ? err.message : err);
            }
          }
        } catch (err) {
          console.warn('[ffmpeg] tags omitted:', err instanceof Error ? err.message : err);
        }
      }

      if (cancelled) {
        settleReject(new EncodeCancelledError());
        return;
      }

      const mergeArgs = buildMergeArgs(partPath, workingPath, hasGlobalTags ? tagsPath : null, videoTid === null ? null : { tid: videoTid, path: videoTagsPath });
      const merge = spawn('mkvmerge', mergeArgs);
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
      if (cancelled) {
        settleReject(new EncodeCancelledError());
        return;
      }

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
        await rm(tagsPath, { force: true });
        await rm(videoTagsPath, { force: true });
        await rename(partPath, output);
        console.log(`[ffmpeg] completed -> ${output}`);
        settleResolve();
      } catch (err) {
        settleReject(err instanceof Error ? err : new Error(String(err)));
      }
    }
  });
}
