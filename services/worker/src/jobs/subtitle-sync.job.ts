import type { Job } from 'bullmq';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SubtitleSyncJob } from '../queue/types';
import {
  subtitleSyncCompleted,
  subtitleSyncDetails,
  subtitleSyncFailed,
  subtitleSyncStarted,
} from '../api/subtitle-sync-reports';
import { deliverReport } from '../api/deliver-report';
import { runFfmpegCapture } from '../ffmpeg/capture';
import { getMetadata } from '../ffmpeg/metadata';
import { ERROR_SUBTITLE_SEARCH_SYNC_FAILED } from '../i18n/error-keys';
import { KeyedError } from '../i18n/keyed-error';
import { lastChapterStartMs, probeChapters } from '../subtitles/chapters';
import { pickSyncReference } from '../subtitles/sync-reference';
import { parseFfsubsyncOutput } from '../subtitles/ffsubsync-output';

export const SYNC_TIMEOUT_MS = 20 * 60 * 1000;
const SYNC_NOT_FOUND_KEY = 'error.subtitleSearch.sync_not_found';

// Spec 103, REQ-10
export async function handleSubtitleSync(job: Job<SubtitleSyncJob>): Promise<void> {
  const id = job.data.subtitleSyncId;

  let details;
  try {
    details = await subtitleSyncDetails(id);
  } catch (err) {
    if (err instanceof KeyedError && err.key === SYNC_NOT_FOUND_KEY) {
      console.log(`[subtitle-sync] ${id} no longer exists, reporting nothing`);
      return;
    }
    throw err;
  }

  const started = await subtitleSyncStarted(id);
  if (!started) {
    console.log(`[subtitle-sync] ${id} no longer queued, reporting nothing`);
    return;
  }

  let tempDir: string | null = null;
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), SYNC_TIMEOUT_MS);

  try {
    const { metadata } = await getMetadata(details.filePath);
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
    const lastChapterMs = lastChapterStartMs(await probeChapters(details.filePath));

    tempDir = await mkdtemp(join(tmpdir(), 'perceptor-subtitle-sync-'));
    const args = [
      details.filePath,
      '-i',
      details.candidatePath,
      '-o',
      join(tempDir, 'out.srt'),
      '--reference-stream',
      reference.streamSpec,
      '--max-offset-seconds',
      '600',
    ];
    if (reference.kind === 'AUDIO') args.push('--vad', 'webrtc');

    const result = await runFfmpegCapture(args, timeout.signal, { binary: 'ffsubsync' });
    if (result.code !== 0) {
      throw new Error(`ffsubsync exited with code ${result.code}: ${result.stderr.slice(-500)}`);
    }

    const parsed = parseFfsubsyncOutput(result.stderr);
    if (!parsed) throw new Error('ffsubsync output could not be parsed');

    await deliverReport(`subtitleSyncCompleted(${id})`, () =>
      subtitleSyncCompleted(
        id,
        parsed.offsetMs,
        parsed.framerateRatio,
        reference.kind,
        parsed.score,
        mediaDurationMs,
        lastChapterMs,
      ),
    );
  } catch (err) {
    console.error(`[subtitle-sync] ${id} failed:`, err);
    await deliverReport(`subtitleSyncFailed(${id})`, () =>
      subtitleSyncFailed(id, ERROR_SUBTITLE_SEARCH_SYNC_FAILED),
    );
  } finally {
    clearTimeout(timer);
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
