"use server";

import { createMovie } from "@/models/movies.model";
import type { MediaSearchResult } from "@/search/types";
import { revalidatePath } from "next/cache";
import { logger } from "@/lib/logger";

export async function addMovieAction(item: MediaSearchResult) {
  try {
    const movie = await createMovie({
      tmdbId: item.id,
      title: item.title,
      overview: item.overview,
      posterUrl: item.posterUrl,
      originalLanguage: item.originalLanguage,
      releaseDate: item.releaseDate,
      status: item.status,
    });

    revalidatePath("/movies");

    
    return { success: true };
  } catch (error) {
    logger.error({ error, item }, "Error creating movie");
    return { success: false, message: "Failed to create movie" };
  }
}