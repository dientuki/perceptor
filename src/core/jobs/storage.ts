import { prisma } from "@/lib/prisma";
import { DownloadStatus, EncodeStatus } from "@prisma/client";

export async function create(tmdbId: number) {
  try {
    const job = await prisma.job.create({
      data: {
        tmdbId,
      },
    });
    return job;
  } catch (error) {
    console.error("Error creando job:", error);
    throw error;
  }
}

export async function update(
  tmdbId: number,
  data: {
    downloadStatus?: DownloadStatus;
    encodeStatus?: EncodeStatus;
    errorMessage?: string | null;
    infoHash?: string;
  }
) {
  try {
    const job = await prisma.job.updateMany({
      where: { tmdbId },
      data,
    });

    return job;
  } catch (error) {
    console.error("Error actualizando job:", error);
    throw error;
  }
}