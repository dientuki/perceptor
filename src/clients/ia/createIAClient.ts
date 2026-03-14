import { IA_CLIENTS, IAClient } from "./types";
import { createGeminiClient } from "./createGeminiClient";
import { getSetting } from "@/models/settings.model";

export async function createIAClient(): Promise<IAClient> {
  const config: Record<string, string> = await getSetting(["ia_client", "ia_model", "ia_key"]);

  if (config.ia_client === IA_CLIENTS.GEMINI) {
    return createGeminiClient(config);
  }

  //if (config.torrent_client === "transmission") {
  //  return createTransmissionStrategy(config);
  //}

  throw new Error("Unsupported IA provider client");
}