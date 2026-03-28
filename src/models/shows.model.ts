import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/**
 * Obtiene un show por su ID de TMDB.
 * @param tmdbId ID único de TMDB.
 */
export async function getShowByTmdbId(tmdbId: number) {
  return prisma.show.findUnique({
    where: { tmdbId },
  });
}

/**
 * Obtiene un show por su ID de base de datos, incluyendo temporadas y episodios.
 * @param id ID único del show en la DB.
 */
export async function getShowById(id: number) {
  return prisma.show.findUnique({
    where: { id },
    include: {
      seasons: {
        orderBy: { seasonNumber: "desc" },
        include: {
          episodes: {
            orderBy: { episodeNumber: "desc" },
            include: {
              job: true,
            },
          },
        },
      },
    },
  });
}

/**
 * Crea un nuevo show en la base de datos.
 * @param data Datos necesarios para crear el show.
 */
export async function createShow(data: Prisma.ShowCreateInput) {
  if (typeof data.releaseDate === "string" && data.releaseDate) {
    data.releaseDate = new Date(data.releaseDate);
  }

  return prisma.show.create({
    data,
  });
}

/**
 * Obtiene la lista de todos los shows ordenados por título.
 */
export async function getAllShows() {
  return prisma.show.findMany({
    orderBy: { title: "asc" },
  });
}
