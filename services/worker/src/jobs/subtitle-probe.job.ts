import type { Job } from 'bullmq';
import { readdir } from 'node:fs/promises';
import { basename, dirname, extname } from 'node:path';
import type { SubtitleProbeJob } from '../queue/types';
import {
  subtitleProbeCompleted,
  subtitleProbeDetails,
  subtitleProbeFailed,
  subtitleProbeStarted,
} from '../api/subtitle-probe-reports';
import { deliverReport } from '../api/deliver-report';
import { getMetadata } from '../ffmpeg/metadata';
import { ERROR_SUBTITLE_SEARCH_PROBE_FAILED } from '../i18n/error-keys';
import { KeyedError } from '../i18n/keyed-error';
import { embeddedLanguages } from '../subtitles/embedded-languages';
import { opensubtitlesHash } from '../subtitles/opensubtitles-hash';
import { sidecarLanguageTags } from '../subtitles/sidecars';

const PROBE_NOT_FOUND_KEY = 'error.subtitleSearch.probe_not_found';

// Spec 107, T012
export async function handleSubtitleProbe(job: Job<SubtitleProbeJob>): Promise<void> {
  const id = job.data.subtitleSearchId;

  let details;
  try {
    details = await subtitleProbeDetails(id);
  } catch (err) {
    if (err instanceof KeyedError && err.key === PROBE_NOT_FOUND_KEY) {
      console.log(`[subtitle-probe] ${id} no longer exists, reporting nothing`);
      return;
    }
    throw err;
  }

  const started = await subtitleProbeStarted(id);
  if (!started) {
    console.log(`[subtitle-probe] ${id} no longer waiting, reporting nothing`);
    return;
  }

  try {
    const { metadata } = await getMetadata(details.filePath);
    const embedded = embeddedLanguages(metadata.streams ?? []);
    const fileName = basename(details.filePath);
    const base = fileName.slice(0, fileName.length - extname(fileName).length);
    const sidecars = sidecarLanguageTags(await readdir(dirname(details.filePath)), base);
    const { size, hash } = await opensubtitlesHash(details.filePath);

    await deliverReport(`subtitleProbeCompleted(${id})`, () =>
      subtitleProbeCompleted(id, embedded, sidecars, size, hash),
    );
  } catch (err) {
    console.error(`[subtitle-probe] ${id} failed:`, err);
    await deliverReport(`subtitleProbeFailed(${id})`, () =>
      subtitleProbeFailed(id, ERROR_SUBTITLE_SEARCH_PROBE_FAILED),
    );
  }
}
