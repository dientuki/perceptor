"use server";

import { createIndexerClient } from "@/clients/indexer/createIndexerClient";
import { TorrentResult } from "@/clients/indexer/types";
import { logger } from "@/lib/logger";
import { createJobFromMagnetAction } from "./jobs";
import { MediaType } from "@prisma/client";

export async function searchTorrentsAction(query: string): Promise<TorrentResult[]> {
  try {
    const indexer = await createIndexerClient();
    const results = await indexer.search(query);
    return results; // Now directly returns TorrentResult[]
  } catch (error) {
    logger.error({ error, query }, "Error en searchTorrentsAction");
    return [];
  }
}

export async function addTorrentToQueueAction(item: { id: number; tmdbId?: number }, urls: string[], mediaType: MediaType) {
  try {
    console.log("addTorrentToQueueAction called with:", { item, urls, mediaType });
    return await createJobFromMagnetAction(item, urls, mediaType);
  } catch (error) {
    logger.error({ error, id: item.id }, "Error en addTorrentToQueueAction");
    return { success: false, message: "Error al encolar el torrent" };
  }
}