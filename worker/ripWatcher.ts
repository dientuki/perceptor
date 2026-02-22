import { logger } from "@/lib/logger";
import { getNextToRip } from "@/models/jobs.model";
import { getSetting } from "@/models/settings.model";
import { TorrentClient } from "@/torrent/types";
import { processRip } from "./rip/processRip";

let isWorking = false;
let interval: NodeJS.Timeout | null = null;
let path_movies: string;

export async function startRipWatcher(torrentClient: TorrentClient) {
  logger.info("👀 RipWatcher iniciando...");

  const paths = await getSetting(["path_movies"]) as Record<string, string>;
  path_movies = paths.path_movies;

  interval = setInterval(() => runCheck(torrentClient), 5000);
}

async function runCheck(torrentClient: TorrentClient) {
  if (isWorking) return;

  const job = await getNextToRip();
  if (!job) return;

  isWorking = true;

  try {
    logger.info({ job }, "📦 Procesando rip...");
    await processRip(job, path_movies, torrentClient);
  } catch (error) {
    logger.error({ error }, "❌ Error en RipWatcher");
  } finally {
    isWorking = false;
  }
}