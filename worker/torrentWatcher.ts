// worker/torrentWatcher.ts
import { logger } from "@/lib/logger";
import { getActiveTorrentJobs, updateJobStates } from "@/models/jobs.model";
import { getSetting } from "@/models/settings.model";
import { DownloadStatus } from "@prisma/client";

let interval: NodeJS.Timeout | null = null;
let endpoint: URL;

// https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-5.0)#get-torrent-list
const DOWNLOADING_STATES = new Set([
  "downloading",        // Torrent is being downloaded and data is being transferred
  "metaDL",             // Torrent has just started downloading and is fetching metadata
  "forcedDL",           // Torrent is forced to downloading to ignore queue limit
  "queuedDL",           // Queuing is enabled and torrent is queued for download
  "stalledDL",          // Torrent is being downloaded, but no connection were made
  "checkingDL",         // Same as checkingUP, but torrent has NOT finished downloading
  "allocating",         // Torrent is allocating disk space for download
  "checkingResumeData", // Checking resume data on qBt startup
]);

const COMPLETED_STATES = new Set([
  "uploading",   // Torrent is being seeded and data is being transferred
  "stalledUP",   // Torrent is being seeded, but no connection were made
  "queuedUP",    // Queuing is enabled and torrent is queued for upload
  "forcedUP",    // Torrent is forced to uploading and ignore queue limit
  "checkingUP",  // Torrent has finished downloading and is being checked
  "moving",      // Torrent is moving to another location (considered “active/completed” depending on context)
]);

const PAUSED_STATES = new Set([
  "pausedDL",    // Torrent is paused and has NOT finished downloading
  "pausedUP",    // Torrent is paused and has finished downloading
  "error",       // Some error occurred, applies to paused torrents
  "missingFiles",// Torrent data files is missing
  "unknown",     // Unknown status
]);

function mapTorrentState(state: string, completion: number): DownloadStatus {
  if (completion !== -1) return DownloadStatus.COMPLETED;
  if (!state) return DownloadStatus.ERROR;

  if (state.includes("error")) return DownloadStatus.ERROR;
  if (PAUSED_STATES.has(state)) return DownloadStatus.PAUSED;
  if (COMPLETED_STATES.has(state)) return DownloadStatus.COMPLETED;
  if (DOWNLOADING_STATES.has(state)) return DownloadStatus.DOWNLOADING;

  return DownloadStatus.ERROR;
}

async function getTorrents() {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  const torrents = await response.json();

  return torrents.map((t: any) => ({
    hash: t.hash,
    state: mapTorrentState(t.state, t.completion_on),
    rawState: t.state,
  }));
}

export async function startTorrentWatcher() {
  logger.info("👀 TorrentWatcher iniciando...");

  // 🔹 Se ejecuta UNA sola vez al boot
  const torrentClient = await getSetting([
    "torrent_host",
    "torrent_port",
  ]) as Record<string, string>;

  const host = torrentClient?.torrent_host ?? "localhost";
  const port = torrentClient?.torrent_port ?? "8080";

  endpoint = new URL(
    "/api/v2/torrents/info",
    `http://${host}:${port}`
  );

  logger.info({ host, port }, "🔌 Cliente torrent configurado");

  // 🔹 recién ahora arranca el interval
  interval = setInterval(runCheck, 5000);
}

async function runCheck() {
  logger.info("🔄 Revisando torrents activos...");

  try {
    const updates: { id: number; downloadStatus: DownloadStatus }[] = [];
    const activeTorrents = await getActiveTorrentJobs();
    const torrentStatus = await getTorrents();

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
        });
      }
    }

    await updateJobStates(updates);

  } catch (error) {
    logger.error({ error }, "❌ Error en TorrentWatcher:");
  }
}
