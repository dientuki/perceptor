"use server";

import { getSearchStrategy } from "@/search/searchFactory";
import { MediaType } from "@/search/types";

export async function searchAction(query: string, type: MediaType) {
  if (!query.trim()) return [];
  
  try {
    const strategy = await getSearchStrategy(type);
    return await strategy.execute(query);
  } catch (error) {
    console.error("Search Error:", error);
    return [];
  }
}