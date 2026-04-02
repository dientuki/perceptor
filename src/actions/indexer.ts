"use server";

import { createIndexerClient } from "@/clients/indexer/createIndexerClient";
import { TorrentResult } from "@/clients/indexer/types";
import { logger } from "@/lib/logger";

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