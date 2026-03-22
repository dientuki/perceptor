import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/**
 * Crea un nuevo episodio en la base de datos.
 * @param data Datos necesarios para crear el episodio.
 */
export async function createEpisode(data: Prisma.EpisodeCreateInput | Prisma.EpisodeUncheckedCreateInput) {
  if (typeof data.releaseDate === "string" && data.releaseDate) {
    data.releaseDate = new Date(data.releaseDate);
  }

  return prisma.episode.create({
    data,
  });
}

/**
 * Obtiene los episodios de una temporada.
 */
export async function getEpisodesBySeasonId(seasonId: number) {
  return prisma.episode.findMany({
    where: { seasonId },
    orderBy: { episodeNumber: "asc" },
  });
}