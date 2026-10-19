// Spec 098, REQ-5
import { spawn } from 'node:child_process';
import { EncodeCancelledError } from '../encode/cancellation';
import { ABORT_KILL_GRACE_MS } from './runner';

export interface RunResult {
  code: number | null;
  stdoutBytes: number;
  stderr: string;
}

export function runFfmpegCapture(args: string[], signal: AbortSignal): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new EncodeCancelledError());
      return;
    }
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdoutBytes = 0;
    let stderr = '';
    let cancelled = false;
    let killTimer: NodeJS.Timeout | null = null;

    const onAbort = () => {
      cancelled = true;
      if (!child.killed) {
        child.kill('SIGTERM');
        killTimer = setTimeout(() => {
          if (child.exitCode === null) child.kill('SIGKILL');
        }, ABORT_KILL_GRACE_MS);
      }
    };
    const cleanup = () => {
      signal.removeEventListener('abort', onAbort);
      if (killTimer) clearTimeout(killTimer);
    };
    signal.addEventListener('abort', onAbort);

    child.stdout.on('data', (data: Buffer) => {
      stdoutBytes += data.length;
    });
    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
    });
    child.on('error', (err) => {
      cleanup();
      reject(err);
    });
    child.on('close', (code) => {
      cleanup();
      if (cancelled) reject(new EncodeCancelledError());
      else resolve({ code, stdoutBytes, stderr });
    });
  });
}
