import { TorrentStrategy } from "./types";
import { HTTP_METHOD } from "@/types/http";
import { DownloadStatus } from "@prisma/client";

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

export const createQbittorrentClient = (config : Record<string, string>): TorrentStrategy => {
  
  const host = config.torrent_host ?? "localhost";
  const port = config.torrent_port ?? "8080";

  const baseUrl = `http://${host}:${port}/api/v2/torrents/`;

  const normalizeHashes = (hashes: string | string[]): string =>
    Array.isArray(hashes) ? hashes.join("|") : hashes;

  return {
  
  /**
   * Obtiene la lista de torrents activos en qbittorrent
   * https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-5.0)#get-torrent-list
   * @returns Promise<ClientTorrentInfo[]>
   */
    async info() {
      const endpoint = new URL("info", baseUrl);

      const response = await fetch(endpoint, {
        method: HTTP_METHOD.GET,
      });

      const torrents = await response.json();

      return torrents.map((t: any) => ({
        hash: t.hash,
        state: mapTorrentState(t.state, t.completion_on),
        rawState: t.state,
        root_path: t.root_path
      }));
    },
  /**
   * Add a torrent to qbittorrent
   * https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-5.0)#add-new-torrent
   * @param {string} url The URL of the torrent to add
   */
    async add(url: string) {
      const endpoint = new URL("add", baseUrl);

      await fetch(endpoint, {
        method: HTTP_METHOD.POST,
        body: new URLSearchParams({ urls: url }),
      });
    },

    /**
     * Stop a torrent from qbittorrent
     * https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-5.0)#pause-torrents
     * @param {string} hashes The info hashes of the torrents to stop
     */
    async stop(hashes: string | string[]) {
      const endpoint = new URL("stop", baseUrl);

      const rest = await fetch(endpoint, {
        method: HTTP_METHOD.POST,
        body: new URLSearchParams({
          hashes: normalizeHashes(hashes),
        }),
      });

      console.log(rest);
    },

  /**
   * Remove a torrent from qbittorrent
   * https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-5.0)#delete-torrents
   * @param {string} hashes The info hashes of the torrents to remove
   * @param {boolean} deleteFiles Whether to delete the downloaded files (default: true)
   */
    async remove(hashes: string | string[], deleteFiles: boolean = true) {
      const endpoint = new URL("delete", baseUrl);
      
      await fetch(endpoint, {
        method: HTTP_METHOD.POST,
        body: new URLSearchParams({
          hashes: normalizeHashes(hashes),
          deleteFiles: deleteFiles.toString(),
        }),
      });
    },
  };
};