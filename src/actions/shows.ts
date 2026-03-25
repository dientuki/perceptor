"use server";

import { createShow } from "@/models/shows.model";
import type { MediaSearchResult } from "@/search/types";
import { revalidatePath } from "next/cache";
import { createSeason } from "@/models/seasons.model";
import { createEpisode } from "@/models/episodes.model";
import { createMovieDBClient } from "@/clients/MovieDB/createMovieDBClient";
import { logger } from "@/lib/logger";
import { MEDIA_TYPE } from "@/types/media";

export async function addShowAction(item: MediaSearchResult) {
  try {
    const show = await createShow({
      tmdbId: item.id,
      title: item.title,
      overview: item.overview,
      posterUrl: item.posterUrl,
      originalLanguage: item.originalLanguage,
      releaseDate: item.releaseDate,
      status: item.status,
    });

    // Ejecutar sincronización en segundo plano (Fire and forget)
    void syncShowMetadata(show.id, item.id);
    
    revalidatePath("/shows");

    
    return { success: true };
  } catch (error) {
    logger.error({ error, item }, "Error creating show");
    return { success: false, message: "Failed to create show" };
  }
}

async function syncShowMetadata(showId: number, tmdbId: number) {
  try {
    const client = await createMovieDBClient();

    const details = await client.details(MEDIA_TYPE.TV, tmdbId);

    if (details.type === MEDIA_TYPE.TV) {
      // Iteramos sobre las temporadas que nos devuelve la API
      for (const seasonInfo of details.seasons) {
      
        // 1. Crear o actualizar la temporada en DB. createSeason ya usa upsert.
        const season = await createSeason({
          showId,
          seasonNumber: seasonInfo.seasonNumber,
          releaseDate: seasonInfo.releaseDate ? new Date(seasonInfo.releaseDate) : null,
        });

        // 2. Buscar episodios de esta temporada en TMDB
        const episodes = await client.seasonDetails(tmdbId, seasonInfo.seasonNumber);
        // 3. Guardar episodios en DB. createEpisode ahora usa upsert para evitar duplicados.
        for (const episode of episodes) {
          await createEpisode({
            seasonId: season.id,
            episodeNumber: episode.episodeNumber,
            title: episode.title,
            overview: episode.overview,
            releaseDate: episode.releaseDate ? new Date(episode.releaseDate) : null,
          });
        }
      }
    }
  } catch (error) {
    logger.error({ error, showId, tmdbId }, `Error syncing metadata for show ${showId}`);
  }
}
