import { SourceStatus } from "@prisma/client";

export const TORRENT_CLIENTS = {
  QBITTORRENT: "qbittorrent",
  TRANSMISSION: "transmission",
} as const;

export type TorrentClientType =
  (typeof TORRENT_CLIENTS)[keyof typeof TORRENT_CLIENTS];

export type TorrentClientInfo = {
  hash: string;
  state: SourceStatus;
  rawState: string;
  root_path: string;
  progress: number; // 0..1, exactly as qBittorrent reports it
  dlspeed: number; // bytes per second
  tags: string[]; // split from qBittorrent's comma-concatenated string
};

export type TorrentClient = {
  info: (tag?: string) => Promise<TorrentClientInfo[]>;
  add: (urls: string[], tags?: string[]) => Promise<string>;
  start: (hashes: string | string[]) => Promise<void>;
  stop: (hashes: string | string[]) => Promise<void>;
  remove: (hashes: string | string[], deleteFiles?: boolean) => Promise<void>;
  setSavePath: (path: string) => Promise<void>;
};