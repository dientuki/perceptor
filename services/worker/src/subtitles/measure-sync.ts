import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runFfmpegCapture } from '../ffmpeg/capture';
import { getMetadata } from '../ffmpeg/metadata';
import { lastChapterStartMs, probeChapters } from './chapters';
import { pickSyncReference, type SyncReference } from './sync-reference';
import { parseFfsubsyncOutput } from './ffsubsync-output';

export type SyncMeasurement = {
  offsetMs: number;
  framerateRatio: number;
  reference: SyncReference['kind'];
  score: number;
  mediaDurationMs: number;
  lastChapterStartMs: number | null;
};

// Spec 113, T008
export async function measureSync(
  filePath: string,
  candidatePath: string,
  signal: AbortSignal,
): Promise<SyncMeasurement> {
  let tempDir: string | null = null;
  try {
    const { metadata } = await getMetadata(filePath);
    const reference = pickSyncReference(metadata.streams ?? []);
    if (!reference) throw new Error('the library file has no usable reference stream');

    const durationSeconds = Number(metadata.format?.duration);
    if (
      metadata.format?.duration === undefined ||
      !Number.isFinite(durationSeconds) ||
      durationSeconds <= 0
    ) {
      throw new Error('the library file duration is missing or unparseable');
    }
    const mediaDurationMs = Math.round(durationSeconds * 1000);
    const lastChapterMs = lastChapterStartMs(await probeChapters(filePath));

    tempDir = await mkdtemp(join(tmpdir(), 'perceptor-subtitle-sync-'));
    const args = [
      filePath,
      '-i',
      candidatePath,
      '-o',
      join(tempDir, 'out.srt'),
      '--reference-stream',
      reference.streamSpec,
      '--max-offset-seconds',
      '600',
    ];
    if (reference.kind === 'AUDIO') args.push('--vad', 'webrtc');

    const result = await runFfmpegCapture(args, signal, { binary: 'ffsubsync' });
    if (result.code !== 0) {
      throw new Error(`ffsubsync exited with code ${result.code}: ${result.stderr.slice(-500)}`);
    }

    const parsed = parseFfsubsyncOutput(result.stderr);
    if (!parsed) throw new Error('ffsubsync output could not be parsed');

    return {
      offsetMs: parsed.offsetMs,
      framerateRatio: parsed.framerateRatio,
      reference: reference.kind,
      score: parsed.score,
      mediaDurationMs,
      lastChapterStartMs: lastChapterMs,
    };
  } finally {
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
