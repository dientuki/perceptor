"use server";
import fs from "node:fs/promises";
import path from "node:path";
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
    const rootPath = await torrentClient.add(magnetLinks);
    logger.info({ infoHash, mediaType, tmdbId, episodeId, movieId, magnetLinks }, "🧲 Magnet links agregados al cliente de torrents.");

    // 4. Create or update Job in DB
    await createJobFromMagnet(tmdbId, {
      infoHash,
      mediaType,
      episodeId,
      movieId,
      rootPath
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

export async function  createJobFromFolderAction(showId: number, seasonId: number, folderPath: string) {
  try {
    // 1. Obtener el tmdbId del show
    const show = await prisma.show.findUnique({
      where: { id: showId },
      select: { tmdbId: true }
    });

    if (!show) throw new Error("Show no encontrado.");

    // 2. Leer la carpeta
    const files = (await fs.readdir(folderPath, { recursive: true })) as string[];
    
    // Filtrar archivos .mkv que sigan el patrón SXXEXX
    const mkvFiles = files.filter(f => f.toLowerCase().endsWith(".mkv"));
    const pattern = /S(\d+)E(\d+)/i;

    // 3. Cargar todos los episodios de la temporada en memoria para evitar consultas repetitivas a la DB
    const episodes = await prisma.episode.findMany({
      where: { seasonId },
      select: { id: true, episodeNumber: true }
    });

    let jobsCreated = 0;

    for (const filename of mkvFiles) {
      const match = filename.match(pattern);
      if (!match) continue;

      const episodeNumber = parseInt(match[2], 10);

      const episode = episodes.find(e => e.episodeNumber === episodeNumber);

      if (!episode) {
        logger.warn({ filename, seasonId, episodeNumber }, "No se encontró el episodio en la base de datos.");
        continue;
      }

      // 4. Crear el job individual
      const absolutePath = path.join(folderPath, filename);
      //console.log(`Creando job para ${episode.id} ${episode}  (Episode ${episodeNumber}) con path: ${absolutePath}`);
      await createJobFromFile(show.tmdbId, {
        rootPath: absolutePath,
        mediaType: MediaType.TV,
        episodeId: episode.id,
        movieId: undefined
      });

      jobsCreated++;
    }

    revalidatePath("/jobs");
    return { success: true, message: `Se han encolado ${jobsCreated} episodios para procesar.` };
  } catch (error) {
    logger.error({ error, folderPath }, "Error en createJobFromFolderAction");
    return { success: false, message: error instanceof Error ? error.message : "Error al importar la carpeta." };
  }
}

export async function createJobFromSeasonMagnetAction(showId: number, seasonId: number, magnetLinks: string[]) {
  try {
    // 1. Obtener el tmdbId del show necesario para el modelo de jobs
    const show = await prisma.show.findUnique({
      where: { id: showId },
      select: { tmdbId: true }
    });
    if (!show) throw new Error("Show no encontrado.");

    // 2. Extraer el infoHash del magnet link
    let infoHash;
    //const match = magnetLinks.match(/btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/);
    for (const link of magnetLinks) {
      const match = link.match(/btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/);
      if (match) {
        infoHash = match[1].toLowerCase();
        break;
      }
    }

    if (!infoHash) {
      return { success: false, message: "No se pudo determinar un Info Hash válido." };
    }

    // 3. Add to torrent client
    const torrentClient = await createTorrentClient();
    const rootPath = await torrentClient.add(magnetLinks);
    
    logger.info({ 
      infoHash, 
      showId, 
      seasonId,
      rootPath
    }, "🧲 Magnet de temporada agregado al cliente con tag 'seasonTorrent'.");

    // 4. Create or update Job in DB
    await createJobFromMagnet(show.tmdbId, {
      infoHash,
      mediaType: MediaType.TV,
      seasonId: seasonId,
      rootPath: rootPath
    });

    // 6. Revalidate paths
    revalidatePath("/jobs");
    revalidatePath("/");

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Error al procesar el magnet de temporada.";
    logger.error({ error, showId, seasonId }, errorMessage);
    return { success: false, message: errorMessage };
  }
}