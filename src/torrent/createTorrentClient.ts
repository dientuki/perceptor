import { TorrentStrategy } from "./types";
import { createQbittorrentClient } from "./createQbittorrentClient";
import { getSetting } from "@/models/settings.model";

export async function createTorrentClient(): Promise<TorrentStrategy> {
  const config = await getSetting(["torrent_client", "torrent_host", "torrent_port"]);

  if (config.torrent_client === "qbittorrent") {
    return createQbittorrentClient(config);
  }

  //if (config.torrent_client === "transmission") {
  //  return createTransmissionStrategy(config);
  //}

  throw new Error("Unsupported torrent client");
}