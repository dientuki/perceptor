import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/**
 * Crea una nueva temporada en la base de datos.
 * @param data Datos necesarios para crear la temporada.
 */
export async function createSeason(data: Prisma.SeasonUncheckedCreateInput) {
  if (typeof data.releaseDate === "string" && data.releaseDate) {
    data.releaseDate = new Date(data.releaseDate);
  }

  return prisma.season.upsert({
    where: {
      showId_seasonNumber: {
        showId: data.showId,
        seasonNumber: data.seasonNumber,
      },
    },
    create: data,
    update: data,
  });
}

/**
 * Obtiene las temporadas de un show.
 */
export async function getSeasonsByShowId(showId: number) {
  return prisma.season.findMany({
    where: { showId },
    orderBy: { seasonNumber: "asc" },
  });
}