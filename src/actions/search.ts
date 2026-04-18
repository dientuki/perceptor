"use server";

import { getSearchStrategy } from "@/search/searchFactory";
import { MediaType } from "@/search/types";
import { logger } from "@/lib/logger";

export async function searchAction(query: string, type: MediaType) {
  if (!query.trim()) return [];
  
  try {
    const strategy = await getSearchStrategy(type);
    return await strategy.execute(query);
  } catch (error) {
    logger.error({ error, query, type }, "Search Error");
    return [];
  }
}