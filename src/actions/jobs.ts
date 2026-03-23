"use server";

import { createJobFromFile } from "@/models/jobs.model";
import { revalidatePath } from "next/cache";
import { MediaType } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function createJobFromFileAction(item: any, filePath: string, mediaType: MediaType) {
  if (!filePath || typeof filePath !== "string") {
    return { success: false, message: "El path del archivo es obligatorio." };
  }

  try {
    let tmdbId: number;
    let episodeId: number;

    if (mediaType === MediaType.TV) {
      const episode = await prisma.episode.findUnique({
        where: { id: item.id },
        select: {
          season: {
            select: { show: { select: { tmdbId: true } } },
          },
        },
      });

      if (!episode?.season?.show?.tmdbId) {
        return { success: false, message: "No se pudo obtener el TMDB ID del show." };
      }
      tmdbId = episode.season.show.tmdbId;
      episodeId = item.id;
    } else {
      tmdbId = item.tmdbId || item.id;
    }

    await createJobFromFile(tmdbId, {
      rootPath: filePath,
      mediaType: mediaType,
      episodeId: episodeId,
    });
    
    revalidatePath("/jobs");
    revalidatePath("/");
    
    return { success: true };
  } catch (error) {
    return { 
      success: false, 
      message: error instanceof Error ? error.message : "Error desconocido al crear el job." 
    };
  }
}