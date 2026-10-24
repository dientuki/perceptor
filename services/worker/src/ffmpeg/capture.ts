// Spec 098, REQ-5
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { EncodeCancelledError } from '../encode/cancellation';
import { ABORT_KILL_GRACE_MS } from './runner';

export interface RunResult {
  code: number | null;
  stdoutBytes: number;
  stderr: string;
  stdout?: string;
  outputs?: string[];
}

export interface CaptureOptions {
  binary?: 'ffmpeg' | 'ffprobe' | 'mkvmerge' | 'ffsubsync';
  keepStdout?: boolean;
  // Spec 102, REQ-4
  extraOutputs?: number;
}

// Spec 099, REQ-5
export const CAPTURE_STDOUT_CAP_BYTES = 32 * 1024 * 1024;

export function runFfmpegCapture(
  args: string[],
  signal: AbortSignal,
  options: CaptureOptions = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new EncodeCancelledError());
      return;
    }
    const extraOutputs = options.extraOutputs ?? 0;
    const stdio: Array<'ignore' | 'pipe'> = ['ignore', 'pipe', 'pipe', ...Array<'pipe'>(extraOutputs).fill('pipe')];
    const child = spawn(options.binary ?? 'ffmpeg', args, { stdio }) as ChildProcessByStdio<null, Readable, Readable>;
    let stdoutBytes = 0;
    let stderr = '';
    const stdoutChunks: Buffer[] = [];
    let overflow = false;
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
      if (options.keepStdout && !overflow) {
        if (stdoutBytes > CAPTURE_STDOUT_CAP_BYTES) {
          overflow = true;
          stdoutChunks.length = 0;
          if (!child.killed) child.kill('SIGTERM');
        } else {
          stdoutChunks.push(data);
        }
      }
    });
    const outputChunks: Buffer[][] = Array.from({ length: extraOutputs }, () => []);
    outputChunks.forEach((chunks, k) => {
      let bytes = 0;
      child.stdio[3 + k]?.on('data', (data: Buffer) => {
        if (overflow) return;
        bytes += data.length;
        if (bytes > CAPTURE_STDOUT_CAP_BYTES) {
          overflow = true;
          chunks.length = 0;
          if (!child.killed) child.kill('SIGTERM');
        } else {
          chunks.push(data);
        }
      });
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
      else if (overflow) reject(new Error('captured stdout exceeded the size cap'));
      else {
        const result: RunResult = {
          code,
          stdoutBytes,
          stderr,
          stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        };
        if (extraOutputs > 0) result.outputs = outputChunks.map((c) => Buffer.concat(c).toString('utf8'));
        resolve(result);
      }
    });
  });
}
