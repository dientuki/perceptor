import type { Job } from 'bullmq';
import type { SubtitleSyncJob } from '../queue/types';
import {
  subtitleSyncCompleted,
  subtitleSyncDetails,
  subtitleSyncFailed,
  subtitleSyncStarted,
} from '../api/subtitle-sync-reports';
import { deliverReport } from '../api/deliver-report';
import { ERROR_SUBTITLE_SEARCH_SYNC_FAILED } from '../i18n/error-keys';
import { KeyedError } from '../i18n/keyed-error';
import { measureSync } from '../subtitles/measure-sync';

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

  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), SYNC_TIMEOUT_MS);

  try {
    const m = await measureSync(details.filePath, details.candidatePath, timeout.signal);

    await deliverReport(`subtitleSyncCompleted(${id})`, () =>
      subtitleSyncCompleted(
        id,
        m.offsetMs,
        m.framerateRatio,
        m.reference,
        m.score,
        m.mediaDurationMs,
        m.lastChapterStartMs,
      ),
    );
  } catch (err) {
    console.error(`[subtitle-sync] ${id} failed:`, err);
    await deliverReport(`subtitleSyncFailed(${id})`, () =>
      subtitleSyncFailed(id, ERROR_SUBTITLE_SEARCH_SYNC_FAILED),
    );
  } finally {
    clearTimeout(timer);
  }
}
