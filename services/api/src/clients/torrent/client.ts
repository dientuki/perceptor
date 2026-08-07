import { Injectable } from '@nestjs/common';
import { TorrentClient } from "./types";
import { HTTP_METHOD } from "@/types/http";
import { SourceStatus } from "@prisma/client";
import { SettingsService } from '@/settings/settings.service';

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

function mapTorrentState(state: string, completion: number): SourceStatus {
  if (completion !== -1) return SourceStatus.READY;
  if (!state) return SourceStatus.ERROR;

  if (state.includes("error")) return SourceStatus.ERROR;
  if (PAUSED_STATES.has(state)) return SourceStatus.PAUSED;
  if (COMPLETED_STATES.has(state)) return SourceStatus.READY;
  if (DOWNLOADING_STATES.has(state)) return SourceStatus.DOWNLOADING;

  return SourceStatus.ERROR;
}

interface QbittorrentTorrent {
  hash: string;
  state: string;
  completion_on: number;
  root_path: string;
}

@Injectable()
export class QbittorrentClient implements TorrentClient {
  constructor(private readonly settings: SettingsService) {}

  private async baseUrl(): Promise<string> {
    const config = await this.settings.getMap();
    return `http://${config.torrent_host}:${config.torrent_port}/api/v2/torrents/`;
  }

  private normalizeHashes(hashes: string | string[]): string {
    return Array.isArray(hashes) ? hashes.join("|") : hashes;
  }

  /**
   * Obtiene la lista de torrents activos en qbittorrent
   * https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-5.0)#get-torrent-list
   * @returns Promise<TorrentClientInfo[]>
   */
  async info() {
    const endpoint = new URL("info", await this.baseUrl());

    const response = await fetch(endpoint, {
      method: HTTP_METHOD.GET,
    });

    const torrents = await response.json();

    return torrents.map((t: QbittorrentTorrent) => ({
      hash: t.hash,
      state: mapTorrentState(t.state, t.completion_on),
      rawState: t.state,
      root_path: t.root_path
    }));
  }

  /**
   * Add a torrent to qbittorrent
   * https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-5.0)#add-new-torrent
   * @param {string[]} urls Array of URLs (magnet links or torrent HTTP URLs) to add
   */
  async add(urls: string[]): Promise<void> {
    const endpoint = new URL("add", await this.baseUrl());

    await fetch(endpoint, {
      method: HTTP_METHOD.POST,
      body: new URLSearchParams({
        urls: urls.join("\n"),
      }),
    });
  }

  /**
   * Stop a torrent from qbittorrent
   * https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-5.0)#pause-torrents
   * @param {string} hashes The info hashes of the torrents to stop
   */
  async stop(hashes: string | string[]) {
    const endpoint = new URL("stop", await this.baseUrl());

    await fetch(endpoint, {
      method: HTTP_METHOD.POST,
      body: new URLSearchParams({
        hashes: this.normalizeHashes(hashes),
      }),
    });
  }

  /**
   * Remove a torrent from qbittorrent
   * https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-5.0)#delete-torrents
   * @param {string} hashes The info hashes of the torrents to remove
   * @param {boolean} deleteFiles Whether to delete the downloaded files (default: true)
   */
  async remove(hashes: string | string[], deleteFiles: boolean = true) {
    const endpoint = new URL("delete", await this.baseUrl());

    await fetch(endpoint, {
      method: HTTP_METHOD.POST,
      body: new URLSearchParams({
        hashes: this.normalizeHashes(hashes),
        deleteFiles: deleteFiles.toString(),
      }),
    });
  }

  /**
   * Cambia la carpeta de descarga (save path) de qbittorrent.
   * https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-5.0)#set-application-preferences
   * @param {string} path Ruta absoluta, dentro del contenedor de qbittorrent
   */
  async setSavePath(path: string): Promise<void> {
    const endpoint = new URL("../app/setPreferences", await this.baseUrl());

    await fetch(endpoint, {
      method: HTTP_METHOD.POST,
      body: new URLSearchParams({
        json: JSON.stringify({ save_path: path, temp_path: `${path}/incomplete` }),
      }),
    });
  }
}
