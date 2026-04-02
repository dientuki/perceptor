import { INDEXER_CLIENTS, IndexerClient } from "./types";
import { createProwlarrClient } from "./createProwlarrClient";
//import { createJackettClient } from "./createJackettClient";
import { getSetting } from "@/models/settings.model";

export async function createIndexerClient(): Promise<IndexerClient> {
  const config: Record<string, string> = await getSetting(["tracker_client", "tracker_host", "tracker_port", "tracker_api_key"]);

  if (config.tracker_client === INDEXER_CLIENTS.PROWLARR) {
    return createProwlarrClient(config);
  }

  //if (config.media_server_client === INDEXER_CLIENTS.JACKETT) {
  //  return createJackettClient(config);
  //}

  throw new Error("Unsupported indexer client");
}