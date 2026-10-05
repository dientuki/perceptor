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

// Spec 022, NFR-7
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
  console.error(`[QbittorrentClient] unrecognised torrent state: "${state}"`);
  return SourceStatus.DOWNLOADING;
}

// Spec 022, NFR-6 T006
export type TorrentCategory = 'movie' | 'short' | 'show';

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
   * Lists the active torrents in qBittorrent, optionally filtered by tag.
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
      throw new TorrentClientError(`qBittorrent rejected the torrents query (${response.status}): ${await response.text()}`, response.status);
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
      throw new TorrentClientError(`qBittorrent rejected the files query (${response.status}): ${await response.text()}`, response.status);
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
   * @param {string} category Optional qBittorrent category naming the content type (movie, short, show). qBittorrent creates an unknown category on add; the savepath stays explicit, so the category never decides where files land.
   */
  async add(urls: string[], tags?: string[], category?: TorrentCategory): Promise<string> {
    const config = await this.settings.getMap();
    const basePath = await this.mediaRoots.resolveFromRoot('downloads', config.path_downloads ?? '.');
    const endpoint = new URL("add", await this.baseUrl());

    const firstUrl = urls[0] ?? "";
    const folder = crypto.createHash("sha256").update(firstUrl).digest("hex").substring(0, 16);

    const savepath = join(basePath, folder);

    const body: Record<string, string> = {
      urls: urls.join("\n"),
      savepath,
    };
    // Spec 022, REQ-5
    if (tags && tags.length > 0) body.tags = tags.join(",");
    if (category) body.category = category;

    const response = await fetch(endpoint, {
      method: HTTP_METHOD.POST,
      body: new URLSearchParams(body),
    });

    if (!response.ok) {
      throw new TorrentClientError(`qBittorrent rejected the torrent (${response.status}): ${await response.text()}`, response.status);
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
      throw new TorrentClientError(`qBittorrent rejected the start (${response.status}): ${await response.text()}`, response.status);
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

    // Spec 022, NFR-6
    if (!response.ok) {
      throw new TorrentClientError(`qBittorrent rejected the stop (${response.status}): ${await response.text()}`, response.status);
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

    // Spec 022, NFR-6
    if (!response.ok) {
      throw new TorrentClientError(`qBittorrent rejected the delete (${response.status}): ${await response.text()}`, response.status);
    }
  }

  /**
   * Changes qBittorrent's download folder (save path).
   * https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-5.0)#set-application-preferences
   * @param {string} path Absolute path, inside qBittorrent's own container
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
