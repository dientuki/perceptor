import { prisma } from "@/lib/prisma";
import { DownloadStatus, EncodeStatus } from "@prisma/client";

type JobStateUpdate = {
  id: number;
  downloadStatus: DownloadStatus;
};

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

export async function getActiveTorrentJobs() {
  return prisma.job.findMany({
    where: {
      downloadStatus: {
        in: [
          DownloadStatus.SEARCHING,
          DownloadStatus.ADDED,
          DownloadStatus.DOWNLOADING,
          DownloadStatus.PAUSED]
      }
    }
  })
}

export async function updateJobStates(
  updates: JobStateUpdate[]
) {
  if (!updates.length) return;

  prisma.$transaction(
    updates.map(update =>
      prisma.job.update({
        where: { id: update.id },
        data: {
          downloadStatus: update.downloadStatus,
        },
      })
    )
  );

  return
}

export async function getNextDownloadJob() {
  return prisma.job.findFirst({
    where: {
      downloadStatus: DownloadStatus.CREATED,
    },
    orderBy: {
      id: "asc",
    },
  });
}