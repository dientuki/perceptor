// worker/torrentWatcher.ts
import { logger } from "@/lib/logger";
import { getActiveTorrentJobs, updateJobStates } from "@/models/jobs.model";
import { DownloadStatus } from "@prisma/client";
import { TorrentClientInfo } from "@/clients/torrent/types";
import { TorrentClient } from "@/clients/torrent/types";

let interval: NodeJS.Timeout | null = null;


type TorrentJobUpdate = {
  id: number;
  downloadStatus: DownloadStatus;
  root_path: string;
  infoHash: string;
};

export async function startTorrentWatcher(torrentClient: TorrentClient) {
  logger.info("👀 TorrentWatcher iniciando...");

  interval = setInterval(() => runCheck(torrentClient), 5000);
}

async function runCheck(torrentClient: TorrentClient) {
  logger.info("🔄 Revisando torrents activos...");

  try {
    const updates: TorrentJobUpdate[] = [];
    const activeTorrents = await getActiveTorrentJobs();
    const torrentStatus: TorrentClientInfo[] = await torrentClient.info();

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

    logger.info(
          `stop ${updates.length} torrents que cambiaron a COMPLETED`
        );

    const hashesToStop = updates
      .filter(u => u.downloadStatus === DownloadStatus.COMPLETED)
      .map(u => u.infoHash);

    await updateJobStates(updates);
    await torrentClient.stop(hashesToStop);
    
  } catch (error) {
    logger.error({ error }, "❌ Error en TorrentWatcher:");
  }
}
