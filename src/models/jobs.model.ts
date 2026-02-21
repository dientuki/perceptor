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

function resolveJobStatus(
  downloadStatus: DownloadStatus,
  encodeStatus: EncodeStatus
): string {
  // 1️⃣ Si hay error en cualquiera
  if (
    downloadStatus === DownloadStatus.ERROR ||
    encodeStatus === EncodeStatus.ERROR
  ) {
    return 'ERROR';
  }

  // 2️⃣ Si ambos completados
  if (
    downloadStatus === DownloadStatus.COMPLETED &&
    encodeStatus === EncodeStatus.COMPLETED
  ) {
    return 'COMPLETED';
  }

  // 3️⃣ Si encode está esperando → mostrar estado del download
  if (encodeStatus === EncodeStatus.WAITING) {
    return downloadStatus;
  }

  // 4️⃣ Si download terminó → mostrar encode
  if (downloadStatus === DownloadStatus.COMPLETED) {
    return encodeStatus;
  }

  // 5️⃣ Default → download manda
  return downloadStatus;
}

export async function getAll(): Promise<Job[]> {
  const jobs = await prisma.job.findMany({
    include: {
      tmdb: true,
    },
  });

  return jobs.map(job => ({
    id: job.id,
    media_type: job.tmdb.media_type,
    name: job.tmdb.name ?? job.tmdb.original_title,
    status: resolveJobStatus(
      job.downloadStatus,
      job.encodeStatus
    ),
    error: job.errorMessage,
  }));
}

export async function getNextToRip() {
  const job = await prisma.job.findFirst({
    where: {
      downloadStatus: DownloadStatus.COMPLETED,
      encodeStatus: EncodeStatus.WAITING,
    },
    include: {
      tmdb: {
        include: {
          language: true, // esto incluye el idioma relacionado
        },
      },
    },
    orderBy: {
      updatedAt: 'asc', // para agarrar el "primero" según la fecha de creación
    },
  });

  return job;
}