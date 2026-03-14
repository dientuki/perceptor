import { INDEXER_CLIENTS, IndexerClient } from "./types";
import { createProwlarrClient } from "./createProwlarrClient";
import { getSetting } from "@/models/settings.model";

export async function createMediaServerClient(): Promise<IndexerClient> {
  const config: Record<string, string> = await getSetting(["tracker_host", "tracker_port", "tracker_api_key"]);

  if (config.media_server_client === INDEXER_CLIENTS.PROWLARR) {
    return createProwlarrClient(config);
  }

  //if (config.torrent_client === "transmission") {
  //  return createTransmissionStrategy(config);
  //}

  throw new Error("Unsupported media server client");
}