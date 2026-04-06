import { logger } from "@/lib/logger";
import { getNextToRip, JobWithEpisode } from "@/models/jobs.model";
import { getSetting } from "@/models/settings.model";
import { TorrentClient } from "@/clients/torrent/types";
import { processRip } from "@/worker/rip/processRip";
import { MediaType } from "@prisma/client";

let isWorking = false;
let interval: NodeJS.Timeout | null = null;
let paths: Record<MediaType, string>;

function isJobReadyToRip(job: JobWithEpisode | null): job is JobWithEpisode & { root_path: string } {
  return !!job && !!job.root_path;
}

export async function startRipWatcher(torrentClient: TorrentClient) {
  logger.info("👀 RipWatcher iniciando...");

  const pathSettings = await getSetting(["path_movies", "path_shows"]) as Record<string, string>;
  paths = {
    [MediaType.MOVIE]: pathSettings.path_movies,
    [MediaType.TV]: pathSettings.path_shows,
  };

  interval = setInterval(() => runCheck(torrentClient), 5000);
}

async function runCheck(torrentClient: TorrentClient) {
  if (isWorking) return;

  const job = await getNextToRip();

  if (!isJobReadyToRip(job)) return;

  isWorking = true;

  try {
    logger.info({ job }, "📦 Procesando rip...");
    await processRip(job, paths[job.mediaType], torrentClient);
    logger.info("📦 Rip completado");
  } catch (error) {
    logger.error({ error }, "❌ Error en RipWatcher");
  } finally {
    isWorking = false;
  }
}