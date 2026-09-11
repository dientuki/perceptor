import { Injectable } from '@nestjs/common';
import { join } from 'node:path';
import crypto from "node:crypto";
import { TorrentClient } from "./types";
import { HTTP_METHOD } from "@/types/http";
import { SourceStatus } from "@prisma/client";
import { SettingsService } from '@/settings/settings.service';
import { MediaRootsService } from '@/media-roots/media-roots.service';

// https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-5.0)#get-torrent-list
const DOWNLOADING_STATES = new Set([
  "downloading",        // Torrent is being downloaded and data is being transferred
  "metaDL",             // Torrent has just started downloading and is fetching metadata
  "forcedDL",           // Torrent is forced to downloading to ignore queue limit
  "forcedMetaDL",       // Torrent is forced to fetch metadata, ignoring queue limit
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

// 5.0 renamed the paused states to stopped; both spellings are still emitted
// by the running container depending on how the torrent got there, so both
// are recognised (spec.md NFR-7). forcedDL/forcedMetaDL are recognised in
// DOWNLOADING_STATES above too, even though nothing in this codebase sets
// the force flag — a user can set it from qBittorrent's own UI.
const PAUSED_STATES = new Set([
  "pausedDL",     // Torrent is paused and has NOT finished downloading (pre-5.0 name)
  "pausedUP",     // Torrent is paused and has finished downloading (pre-5.0 name)
  "stoppedDL",    // Torrent is stopped and has NOT finished downloading (5.0 name)
  "stoppedUP",    // Torrent is stopped and has finished downloading (5.0 name)
  "error",        // Some error occurred, applies to paused torrents
  "missingFiles", // Torrent data files is missing
  "unknown",      // Unknown status
]);

function mapTorrentState(state: string, completion: number): SourceStatus {
  if (completion !== -1) return SourceStatus.READY;
  if (!state) return SourceStatus.ERROR;

  if (state.includes("error")) return SourceStatus.ERROR;
  if (PAUSED_STATES.has(state)) return SourceStatus.PAUSED;
  if (COMPLETED_STATES.has(state)) return SourceStatus.READY;
  if (DOWNLOADING_STATES.has(state)) return SourceStatus.DOWNLOADING;

  // An unrecognised state used to be laundered into ERROR, which is exactly
  // what DownloadsService.handleTorrentCompleted reads as "superseded,
  // ignore" — a correctly running-but-unclassified torrent would silently
  // vanish from the race arbiter's view. Log it instead, loudly, and fall
  // back to DOWNLOADING: never terminal, so it can neither be mistaken for
  // the winner (READY) nor for a discarded loser (ERROR).
  console.error(`[QbittorrentClient] estado de torrent no reconocido: "${state}"`);
  return SourceStatus.DOWNLOADING;
}

// Carries the HTTP status alongside the message so a caller (DownloadsService,
// NFR-6/T006) can translate a rejection into TORRENT_CLIENT_REJECTED with
// `{status}` as an interpolation param, rather than parsing it back out of a
// string. `status` is 0 for a fetch()-level failure — the client unreachable
// entirely, not merely answering with a non-2xx.
export class TorrentClientError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'TorrentClientError';
  }
}

interface QbittorrentTorrent {
  hash: string;
  state: string;
  completion_on: number;
  root_path: string;
  progress: number;
  dlspeed: number;
  tags: string;
}

interface QbittorrentTorrentFile {
  name: string;
  priority: number;
  progress: number;
}

@Injectable()
export class QbittorrentClient implements TorrentClient {
  constructor(
    private readonly settings: SettingsService,
    private readonly mediaRoots: MediaRootsService,
  ) {}

  private async baseUrl(): Promise<string> {
    const config = await this.settings.getMap();
    return `http://${config.torrent_host}:${config.torrent_port}/api/v2/torrents/`;
  }

  // Lowercases every entry before joining: an indexer-sourced infoHash is
  // stored uppercase, and qBittorrent silently no-ops start/stop/remove
  // against a hash it does not recognise rather than 404ing, so a mismatch
  // here used to fail with no error anywhere.
  private normalizeHashes(hashes: string | string[]): string {
    const list = Array.isArray(hashes) ? hashes : [hashes];
    return list.map((hash) => hash.toLowerCase()).join("|");
  }

  /**
   * Obtiene la lista de torrents activos en qbittorrent, opcionalmente filtrada por tag.
   * https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-5.0)#get-torrent-list
   * @param {string} tag Optional tag to filter server-side; omitted returns every torrent.
   * @returns Promise<TorrentClientInfo[]>
   */
  async info(tag?: string) {
    const endpoint = new URL("info", await this.baseUrl());
    if (tag) endpoint.searchParams.set("tag", tag);

    const response = await fetch(endpoint, {
      method: HTTP_METHOD.GET,
    });

    // Same reasoning as add(): a silent failure here would be read by the
    // caller as "no torrents", never as "qBittorrent is unreachable".
    if (!response.ok) {
      throw new TorrentClientError(`qBittorrent rechazó la consulta de torrents (${response.status}): ${await response.text()}`, response.status);
    }

    const torrents = await response.json();

    return torrents.map((t: QbittorrentTorrent) => ({
      hash: t.hash,
      state: mapTorrentState(t.state, t.completion_on),
      rawState: t.state,
      root_path: t.root_path,
      progress: t.progress,
      dlspeed: t.dlspeed,
      tags: t.tags ? t.tags.split(",").map((tagName) => tagName.trim()).filter(Boolean) : [],
    }));
  }

  /**
   * Lists the per-file state of a torrent — priority and progress, the two
   * facts needed to tell a file the user deselected from one that actually
   * downloaded (052-deselected-torrent-files). The hash is lowercased before
   * the request: an indexer-sourced infoHash is stored uppercase, and
   * qBittorrent answers 404 for it otherwise.
   * https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-5.0)#get-torrent-contents
   * @param {string} hash The torrent's info hash
   */
  async files(hash: string) {
    const endpoint = new URL("files", await this.baseUrl());
    endpoint.searchParams.set("hash", hash.toLowerCase());

    const response = await fetch(endpoint, {
      method: HTTP_METHOD.GET,
    });

    // Same reasoning as info(): the caller must never mistake "qBittorrent
    // does not know this hash" for "nothing was downloaded" — both must
    // surface as a thrown error here, never as an empty array.
    if (!response.ok) {
      throw new TorrentClientError(`qBittorrent rechazó la consulta de archivos (${response.status}): ${await response.text()}`, response.status);
    }

    const files = await response.json();

    return files.map((f: QbittorrentTorrentFile) => ({
      name: f.name,
      priority: f.priority,
      progress: f.progress,
    }));
  }

  /**
   * Add a torrent to qbittorrent
   * https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-5.0)#add-new-torrent
   * @param {string[]} urls Array of URLs (magnet links or torrent HTTP URLs) to add
   * @param {string[]} tags Optional tags, applied inline on add — no second call, no untagged window.
   */
  async add(urls: string[], tags?: string[]): Promise<string> {
    const config = await this.settings.getMap();
    // path_downloads se guarda relativo a la raíz "downloads" (ver
    // media-roots/): acá se resuelve a la ruta absoluta que qBittorrent
    // necesita — corre en su propio container, pero monta el mismo
    // CONTAINER_DOWNLOADS_DIR, así que la ruta absoluta es válida ahí también.
    const basePath = await this.mediaRoots.resolveFromRoot('downloads', config.path_downloads ?? '.');
    const endpoint = new URL("add", await this.baseUrl());

    const firstUrl = urls[0] ?? "";
    // Generamos un hash a partir de la primera URL para asegurar una carpeta única
    const folder = crypto.createHash("sha256").update(firstUrl).digest("hex").substring(0, 16);

    const savepath = join(basePath, folder);

    const body: Record<string, string> = {
      urls: urls.join("\n"),
      savepath,
    };
    // qBittorrent's tags param is comma-separated on the wire (REQ-5's
    // sanitisation exists because of this exact separator).
    if (tags && tags.length > 0) body.tags = tags.join(",");

    const response = await fetch(endpoint, {
      method: HTTP_METHOD.POST,
      body: new URLSearchParams(body),
    });

    // Con urls que vienen de Prowlarr esto casi nunca falla; con un magnet
    // tipeado a mano por el usuario, qBittorrent puede rechazarlo (415). Sin
    // este chequeo se crea igual un MediaSource en QUEUED que nunca baja —
    // hay que fallar acá, antes de que el caller cree nada en la DB.
    if (!response.ok) {
      throw new TorrentClientError(`qBittorrent rechazó el torrent (${response.status}): ${await response.text()}`, response.status);
    }

    return savepath;
  }

  /**
   * Start (resume) a torrent in qbittorrent. Plain resume — not a force start,
   * which is a distinct torrent state deliberately out of scope here.
   * https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-5.0)#start-torrents
   * @param {string} hashes The info hashes of the torrents to start
   */
  async start(hashes: string | string[]) {
    const endpoint = new URL("start", await this.baseUrl());

    const response = await fetch(endpoint, {
      method: HTTP_METHOD.POST,
      body: new URLSearchParams({
        hashes: this.normalizeHashes(hashes),
      }),
    });

    if (!response.ok) {
      throw new TorrentClientError(`qBittorrent rechazó el start (${response.status}): ${await response.text()}`, response.status);
    }
  }

  /**
   * Stop a torrent from qbittorrent
   * https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-5.0)#stop-torrents
   * @param {string} hashes The info hashes of the torrents to stop
   */
  async stop(hashes: string | string[]) {
    const endpoint = new URL("stop", await this.baseUrl());

    const response = await fetch(endpoint, {
      method: HTTP_METHOD.POST,
      body: new URLSearchParams({
        hashes: this.normalizeHashes(hashes),
      }),
    });

    // An unacknowledged stop leaves a loser downloading while the database
    // says PAUSED (NFR-6) — silently swallowing this is worse than throwing.
    if (!response.ok) {
      throw new TorrentClientError(`qBittorrent rechazó el stop (${response.status}): ${await response.text()}`, response.status);
    }
  }

  /**
   * Remove a torrent from qbittorrent
   * https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-5.0)#delete-torrents
   * @param {string} hashes The info hashes of the torrents to remove
   * @param {boolean} deleteFiles Whether to delete the downloaded files (default: true)
   */
  async remove(hashes: string | string[], deleteFiles: boolean = true) {
    const endpoint = new URL("delete", await this.baseUrl());

    const response = await fetch(endpoint, {
      method: HTTP_METHOD.POST,
      body: new URLSearchParams({
        hashes: this.normalizeHashes(hashes),
        deleteFiles: deleteFiles.toString(),
      }),
    });

    // An unacknowledged delete leaves the user's file on disk after the row
    // is gone (NFR-6) — the caller must see this fail rather than assume it.
    if (!response.ok) {
      throw new TorrentClientError(`qBittorrent rechazó el delete (${response.status}): ${await response.text()}`, response.status);
    }
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
