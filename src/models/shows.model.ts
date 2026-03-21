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
