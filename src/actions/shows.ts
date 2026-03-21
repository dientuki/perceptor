"use server";

import { createShow } from "@/models/shows.model";
import { MediaSearchResult } from "@/search/types";
import { revalidatePath } from "next/cache";

export async function addShowAction(item: MediaSearchResult) {
  try {
    await createShow({
      tmdbId: item.id,
      title: item.title,
      description: item.description,
      posterUrl: item.posterUrl,
      originalLanguage: item.originalLanguage,
      releaseDate: item.releaseDate,
    });
    
    revalidatePath("/shows");
    return { success: true };
  } catch (error) {
    console.error("Error creating show:", error);
    return { success: false, error: "Failed to create show" };
  }
}
