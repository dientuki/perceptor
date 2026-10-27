import type { Job } from 'bullmq';
import { readdir } from 'node:fs/promises';
import { basename, dirname, extname } from 'node:path';
import type { LibraryProbeJob } from '../queue/types';
import {
  libraryProbeCompleted,
  libraryProbeDetails,
} from '../api/library-probe-reports';
import type { LibraryProbeTarget } from '../api/library-probe-reports';
import { deliverReport } from '../api/deliver-report';
import { getMetadata } from '../ffmpeg/metadata';
import { KeyedError } from '../i18n/keyed-error';
import { audioLanguages } from '../subtitles/audio-languages';
import { embeddedLanguages } from '../subtitles/embedded-languages';
import { sidecarLanguageTags } from '../subtitles/sidecars';

// Spec 108, T008
export async function handleLibraryProbe(job: Job<LibraryProbeJob>): Promise<void> {
  const { movieId, episodeId } = job.data;
  const hasMovie = movieId !== undefined && movieId !== null;
  const hasEpisode = episodeId !== undefined && episodeId !== null;

  if (hasMovie === hasEpisode) {
    console.log(`[library-probe] payload needs exactly one of movieId/episodeId, ignoring`);
    return;
  }

  const target: LibraryProbeTarget = hasMovie ? { movieId } : { episodeId };
  const label = hasMovie ? `movie ${movieId}` : `episode ${episodeId}`;

  let filePath: string;
  try {
    ({ filePath } = await libraryProbeDetails(target));
  } catch (err) {
    if (err instanceof KeyedError) {
      console.log(`[library-probe] ${label}: ${err.key}, reporting nothing`);
      return;
    }
    throw err;
  }

  let audio: string[];
  let embedded: string[];
  let sidecars: string[];
  try {
    const { metadata } = await getMetadata(filePath);
    const streams = metadata.streams ?? [];
    audio = audioLanguages(streams);
    embedded = embeddedLanguages(streams);
    const fileName = basename(filePath);
    const base = fileName.slice(0, fileName.length - extname(fileName).length);
    sidecars = sidecarLanguageTags(await readdir(dirname(filePath)), base);
  } catch (err) {
    console.error(`[library-probe] ${label}: reading ${filePath} failed, reporting nothing:`, err);
    return;
  }

  const accepted = await deliverReport(`libraryProbeCompleted(${label})`, () =>
    libraryProbeCompleted(target, filePath, audio, embedded, sidecars),
  );
  if (!accepted) {
    console.log(`[library-probe] ${label}: report discarded as stale (${filePath})`);
  }
}
