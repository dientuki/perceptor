import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/**
 * Obtiene un show por su ID de base de datos, incluyendo temporadas y episodios.
 * @param id ID único del show en la DB.
 */
export async function getMovieById(id: number) {
  return prisma.movie.findUnique({
    where: { id },
  });
}

/**
 * Crea un nuevo movie en la base de datos.
 * @param data Datos necesarios para crear el movie.
 */
export async function createMovie(data: Prisma.MovieCreateInput) {
  if (typeof data.releaseDate === "string" && data.releaseDate) {
    data.releaseDate = new Date(data.releaseDate);
  }

  return prisma.movie.create({
    data,
  });
}

/**
 * Obtiene la lista de todos los movies ordenados por título.
 */
export async function getAllMovies() {
  return prisma.movie.findMany({
    orderBy: { title: "asc" },
  });
}
