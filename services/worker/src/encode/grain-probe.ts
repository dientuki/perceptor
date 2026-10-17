// Spec 094, REQ-6 REQ-7 REQ-8
import { spawn } from 'node:child_process';
import { EncodeCancelledError } from './cancellation';
import type { ContentKind } from './content-kind';
import { RESOLUTION_BOXES, buildSvtav1Params, exceedsBox } from '../ffmpeg/params';
import { ABORT_KILL_GRACE_MS } from '../ffmpeg/runner';

// Spec 094, REQ-7
export const GRAIN_PROBE_SAVED_MBPS_THRESHOLD = 0.886;

// Spec 094, REQ-6
export const GRAIN_PROBE_MIN_DURATION_SECONDS = 30;
export const GRAIN_PROBE_WINDOW_COUNT = 9;
export const GRAIN_PROBE_WINDOW_SECONDS = 6;
export const GRAIN_PROBE_CROP_SAMPLES = 5;
export const GRAIN_PROBE_CROP_SECONDS = 5;
export const GRAIN_PROBE_CRF = 22;
export const GRAIN_PROBE_PRESET = 8;
export const GRAIN_PROBE_MIN_WINDOW_BYTES = 1000;

export interface GrainProbeResult {
  mbpsGrain0: number;
  savingPct: number;
  savedMbps: number;
  passed: boolean;
}

export interface WindowSizes {
  bytes0: number;
  bytesGrain: number;
}

export function cropTimestamps(duration: number): number[] {
  const n = GRAIN_PROBE_CROP_SAMPLES;
  return Array.from({ length: n }, (_, i) => duration * (0.1 + (0.7 * i) / (n > 1 ? n - 1 : 1)));
}

export function windowTimestamps(duration: number): number[] {
  const n = GRAIN_PROBE_WINDOW_COUNT;
  return Array.from({ length: n }, (_, i) => duration * 0.05 + duration * 0.9 * ((i + 0.5) / n));
}

export function majorityCrop(crops: string[]): string | null {
  const counts = new Map<string, number>();
  for (const crop of crops) counts.set(crop, (counts.get(crop) ?? 0) + 1);
  let best: string | null = null;
  let bestCount = 0;
  for (const [crop, count] of counts) {
    if (count > bestCount) {
      best = crop;
      bestCount = count;
    }
  }
  return best;
}

// Spec 094, REQ-8
export function buildProbeVideoFilter(
  crop: string | null,
  width: number,
  height: number,
): string | null {
  let w = width;
  let h = height;
  const match = crop?.match(/^crop=(\d+):(\d+):\d+:\d+$/);
  if (match) {
    w = Number(match[1]);
    h = Number(match[2]);
  }
  const box = RESOLUTION_BOXES['1080p'];
  const filters: string[] = [];
  if (crop) filters.push(crop);
  if (box && exceedsBox(w, h, box)) {
    filters.push(
      `scale=${box.width}:${box.height}:force_original_aspect_ratio=decrease:force_divisible_by=2`,
    );
  }
  return filters.length > 0 ? filters.join(',') : null;
}

export function computeGrainSaving(windows: WindowSizes[]): GrainProbeResult {
  const counted = windows.filter(
    (w) => w.bytes0 > GRAIN_PROBE_MIN_WINDOW_BYTES && w.bytesGrain > GRAIN_PROBE_MIN_WINDOW_BYTES,
  );
  if (counted.length === 0) throw new Error('every grain probe encode failed');
  const sum0 = counted.reduce((a, w) => a + w.bytes0, 0);
  const sumGrain = counted.reduce((a, w) => a + w.bytesGrain, 0);
  const savingPct = (1 - sumGrain / sum0) * 100;
  const mbpsGrain0 = (sum0 * 8) / (counted.length * GRAIN_PROBE_WINDOW_SECONDS) / 1e6;
  const savedMbps = (mbpsGrain0 * savingPct) / 100;
  return {
    mbpsGrain0,
    savingPct,
    savedMbps,
    passed: savedMbps >= GRAIN_PROBE_SAVED_MBPS_THRESHOLD,
  };
}

export function buildWindowEncodeArgs(
  input: string,
  at: number,
  filter: string | null,
  svtav1Params: string,
): string[] {
  const args = [
    '-hide_banner', '-nostdin', '-nostats', '-v', 'error',
    '-ss', at.toFixed(2), '-t', String(GRAIN_PROBE_WINDOW_SECONDS), '-i', input,
    '-an', '-sn', '-map', '0:v:0',
  ];
  if (filter) args.push('-vf', filter);
  args.push(
    '-c:v', 'libsvtav1', '-crf', String(GRAIN_PROBE_CRF), '-preset', String(GRAIN_PROBE_PRESET),
    '-pix_fmt', 'yuv420p10le', '-svtav1-params', svtav1Params,
    '-f', 'matroska', 'pipe:1',
  );
  return args;
}

interface RunResult {
  code: number | null;
  stdoutBytes: number;
  stderr: string;
}

function runProbeFfmpeg(args: string[], signal: AbortSignal): Promise<RunResult> {
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

async function detectCrop(input: string, at: number, signal: AbortSignal): Promise<string | null> {
  const { stderr } = await runProbeFfmpeg(
    [
      '-hide_banner', '-nostdin', '-nostats', '-ss', at.toFixed(2),
      '-t', String(GRAIN_PROBE_CROP_SECONDS), '-i', input, '-an', '-sn',
      '-vf', 'cropdetect=limit=24:round=2:reset=0', '-f', 'null', '-',
    ],
    signal,
  );
  const matches = stderr.match(/crop=\d+:\d+:\d+:\d+/g);
  return matches ? matches[matches.length - 1] : null;
}

async function encodedBytes(args: string[], signal: AbortSignal): Promise<number> {
  const { code, stdoutBytes } = await runProbeFfmpeg(args, signal);
  return code === 0 ? stdoutBytes : 0;
}

export async function probeGrainSaving(
  input: string,
  metadata: any,
  contentKind: ContentKind,
  signal: AbortSignal,
): Promise<GrainProbeResult> {
  const duration = Number.parseFloat(metadata?.format?.duration);
  if (!Number.isFinite(duration) || duration < GRAIN_PROBE_MIN_DURATION_SECONDS) {
    throw new Error(`grain probe needs a duration of at least ${GRAIN_PROBE_MIN_DURATION_SECONDS}s`);
  }
  const video = (metadata?.streams ?? []).find((s: any) => s.codec_type === 'video');
  const width = Number(video?.width);
  const height = Number(video?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error('grain probe found no video dimensions');
  }

  const crops: string[] = [];
  for (const at of cropTimestamps(duration)) {
    const crop = await detectCrop(input, at, signal);
    if (crop) crops.push(crop);
  }
  const filter = buildProbeVideoFilter(majorityCrop(crops), width, height);

  const params0 = buildSvtav1Params(contentKind, false);
  const paramsGrain = buildSvtav1Params(contentKind, true);
  const windows: WindowSizes[] = [];
  for (const at of windowTimestamps(duration)) {
    const bytes0 = await encodedBytes(buildWindowEncodeArgs(input, at, filter, params0), signal);
    const bytesGrain = await encodedBytes(
      buildWindowEncodeArgs(input, at, filter, paramsGrain),
      signal,
    );
    windows.push({ bytes0, bytesGrain });
  }
  return computeGrainSaving(windows);
}
