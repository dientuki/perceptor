// worker/torrentWatcher.ts
import { logger } from "@/lib/logger";
import { getActiveTorrentJobs, updateJobStates } from "@/models/jobs.model";
import { createTorrentClient } from "@/torrent/createTorrentClient";
import { DownloadStatus } from "@prisma/client";
import { ClientTorrentInfo } from "@/torrent/types";

let interval: NodeJS.Timeout | null = null;
let torrentClient: Awaited<ReturnType<typeof createTorrentClient>>;

type TorrentJobUpdate = {
  id: number;
  downloadStatus: DownloadStatus;
  root_path: string;
  infoHash: string;
};

export async function startTorrentWatcher() {
  logger.info("👀 TorrentWatcher iniciando...");

  torrentClient = await createTorrentClient();
  interval = setInterval(runCheck, 5000);
}

async function runCheck() {
  logger.info("🔄 Revisando torrents activos...");

  try {
    const updates: TorrentJobUpdate[] = [];
    const activeTorrents = await getActiveTorrentJobs();
    const torrentStatus: ClientTorrentInfo[] = await torrentClient.info();

    logger.info({ activeTorrents, torrentStatus }, "📦 Torrents activos");

    // 🔹 Indexamos la DB por hash
    const activeMap = new Map(
      activeTorrents.map(t => [t.infoHash, t])
    );

    // 🔹 Recorremos los estados del cliente
    for (const torrent of torrentStatus) {
      const job = activeMap.get(torrent.hash);

      if (!job) continue; // no está en DB

      if (job.downloadStatus !== torrent.state) {
        logger.info(
          `🔄 ${job.infoHash} cambió de ${job.downloadStatus} → ${torrent.state}`
        );

        updates.push({
          id: job.id,
          downloadStatus: torrent.state,
          root_path: torrent.root_path,
          infoHash: torrent.hash
        });
      }
    }

    if (updates.length === 0) return;

    const hashesToStop = updates
      .filter(u => u.downloadStatus === DownloadStatus.COMPLETED)
      .map(u => u.infoHash);
    
    await updateJobStates(updates);
    await torrentClient.stop(hashesToStop);

  } catch (error) {
    logger.error({ error }, "❌ Error en TorrentWatcher:");
  }
}
