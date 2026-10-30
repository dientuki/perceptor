import type { Job } from 'bullmq';
import type { SubtitleEmbedSyncJob } from '../queue/types';
import {
  subtitleEmbedSyncCompleted,
  subtitleEmbedSyncDetails,
  subtitleEmbedSyncFailed,
} from '../api/subtitle-embed-sync-reports';
import { deliverReport } from '../api/deliver-report';
import { ERROR_SUBTITLE_EMBED_SYNC_FAILED } from '../i18n/error-keys';
import { KeyedError } from '../i18n/keyed-error';
import { measureSync } from '../subtitles/measure-sync';
import { SYNC_TIMEOUT_MS } from './subtitle-sync.job';

const SYNC_NOT_FOUND_KEY = 'error.subtitleEmbed.sync_not_found';

// Spec 113, T009
export async function handleSubtitleEmbedSync(job: Job<SubtitleEmbedSyncJob>): Promise<void> {
  const { subtitleEmbedId: id, fileName } = job.data;

  let details;
  try {
    details = await subtitleEmbedSyncDetails(id, fileName);
  } catch (err) {
    if (err instanceof KeyedError && err.key === SYNC_NOT_FOUND_KEY) {
      console.log(`[subtitle-embed-sync] ${id} ${fileName} no longer measuring, reporting nothing`);
      return;
    }
    throw err;
  }

  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), SYNC_TIMEOUT_MS);

  try {
    const m = await measureSync(details.filePath, details.candidatePath, timeout.signal);

    await deliverReport(`subtitleEmbedSyncCompleted(${id}, ${fileName})`, () =>
      subtitleEmbedSyncCompleted(
        id,
        fileName,
        m.offsetMs,
        m.framerateRatio,
        m.reference,
        m.score,
        m.mediaDurationMs,
        m.lastChapterStartMs,
      ),
    );
  } catch (err) {
    console.error(`[subtitle-embed-sync] ${id} ${fileName} failed:`, err);
    await deliverReport(`subtitleEmbedSyncFailed(${id}, ${fileName})`, () =>
      subtitleEmbedSyncFailed(id, fileName, ERROR_SUBTITLE_EMBED_SYNC_FAILED),
    );
  } finally {
    clearTimeout(timer);
  }
}
