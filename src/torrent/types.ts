import { DownloadStatus } from "@prisma/client";

export const TORRENT_CLIENTS = {
  QBITTORRENT: "qbittorrent",
  TRANSMISSION: "transmission",
} as const;

export type TorrentClientType =
  (typeof TORRENT_CLIENTS)[keyof typeof TORRENT_CLIENTS];

export type ClientTorrentInfo = {
  hash: string;
  state: DownloadStatus;
  rawState: string;
  root_path: string;
};

export type TorrentStrategy = {
  info: () => Promise<ClientTorrentInfo[]>;
  add: (torrent: string) => Promise<void>;
  stop: (hashes: string | string[]) => Promise<void>;
  remove: (hashes: string | string[], deleteFiles: boolean) => Promise<void>;
};