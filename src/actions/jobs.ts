"use server";

import { createJobFromFile, createJobFromMagnet } from "@/models/jobs.model";
import { revalidatePath } from "next/cache";
import { MediaType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createTorrentClient } from "@/clients/torrent/createTorrentClient";
import { logger } from "@/lib/logger";

interface MediaItem {
	id: number;
	tmdbId?: number;
  infoHash?: string;
}

/**
 * Resuelve el tmdbId del show y el episodeId (si aplica)
 */
async function resolveMediaIds(item: MediaItem, mediaType: MediaType) {
  let tmdbId: number;
  let episodeId: number | undefined;
  let movieId: number | undefined;

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
      throw new Error("No se pudo obtener el TMDB ID del show.");
    }
    tmdbId = episode.season.show.tmdbId;
    episodeId = item.id;
  } else {
    tmdbId = item.tmdbId || item.id;
    movieId = item.id;
  }

  return { tmdbId, episodeId, movieId };
}

export async function createJobFromFileAction(item: MediaItem, filePath: string, mediaType: MediaType) {
  if (!filePath || typeof filePath !== "string") {
    return { success: false, message: "El path del archivo es obligatorio." };
  }

  try {
    const { tmdbId, episodeId, movieId } = await resolveMediaIds(item, mediaType);

    await createJobFromFile(tmdbId, {
      rootPath: filePath,
      mediaType: mediaType,
      episodeId: episodeId,
      movieId: movieId,
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

export async function createJobFromMagnetAction(item: MediaItem, magnetLinks: string[], mediaType: MediaType) {
  //const validLinks = magnetLinks?.filter((link) => link.startsWith("magnet:?xt=urn:btih:")) || [];
//
  //if (validLinks.length === 0) {
  //  return { success: false, message: "No se proporcionaron links Magnet válidos." };
  //}

  try {
    let infoHash = item.infoHash?.toLowerCase();

    if (!infoHash) {
      // Extract infohash from valid magnet links if not provided in item
      // Soporta hashes hex (40 chars) y base32 (32 chars)
      for (const link of magnetLinks) {
        const match = link.match(/btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/);
        if (match) {
          infoHash = match[1].toLowerCase();
          break;
        }
      }
    }

    if (!infoHash) {
      return { success: false, message: "No se pudo determinar un Info Hash válido." };
    }

    // 2. Determine tmdbId and episodeId
    const { tmdbId, episodeId, movieId } = await resolveMediaIds(item, mediaType);

    // 3. Add to torrent client
    const torrentClient = await createTorrentClient();
    await torrentClient.add(magnetLinks);
    logger.info({ infoHash, mediaType, tmdbId, episodeId, movieId, magnetLinks }, "🧲 Magnet links agregados al cliente de torrents.");

    // 4. Create or update Job in DB
    await createJobFromMagnet(tmdbId, {
      infoHash,
      mediaType,
      episodeId,
      movieId,
    });

    // 6. Revalidate paths
    revalidatePath("/jobs");
    revalidatePath("/");

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Error desconocido al crear el job desde magnet.";
    logger.error({ error, item, magnetLinks }, errorMessage);
    return { success: false, message: errorMessage };
  }
}