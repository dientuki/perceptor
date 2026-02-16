import { prisma } from "@/lib/prisma";

export async function create(tmdbId: number) {
  try {
    const job = await prisma.job.create({
      data: {
        tmdbId,
        status: "pending",
      },
    });
    return job;
  } catch (error) {
    console.error("Error creando task:", error);
    throw error;
  }
}

export async function update(tmdbId: number, status: string) {
  try {
    const job = await prisma.job.updateMany({
      where: { tmdbId },
      data: { status },
    });
    return job;
  } catch (error) {
    console.error("Error actualizando task:", error);
    throw error;
  }
}