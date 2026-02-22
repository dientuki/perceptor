import { MediaServerClient } from "./types";
import { createJellyfinClient } from "./createJellyfinClient";
import { getSetting } from "@/models/settings.model";

export async function createMediaServerClient(): Promise<MediaServerClient> {
  const config: Record<string, string> = await getSetting([
    "media_server_client", "media_server_host", "media_server_port", "media_server_api_key"
  ]);

  if (config.media_server_client === "jellyfin") {
    return createJellyfinClient(config);
  }

  //if (config.torrent_client === "transmission") {
  //  return createTransmissionStrategy(config);
  //}

  throw new Error("Unsupported media server client");
}