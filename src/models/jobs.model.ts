import { prisma } from "@/lib/prisma";
import { DownloadStatus, EncodeStatus, MediaType, Prisma } from "@prisma/client";
import { JobStateUpdate } from "@/models/types";
import { logger } from "@/lib/logger";

export async function create(tmdbId: number) {
  try {
    const job = await prisma.job.create({
      data: {
        tmdbId,
      },
    });
    return job;
  } catch (error) {
    logger.error({ error, tmdbId }, "Error creando job");
    throw error;
  }
}

export async function update(
  id: number,
  data: {
    downloadStatus?: DownloadStatus;
    encodeStatus?: EncodeStatus;
    errorMessage?: string | null;
    infoHash?: string;
    root_path?: string;
    ffmpegCommand?: string;
  }
) {
  try {
    const job = await prisma.job.update({
      where: { id },
      data,
    });

    return job;
  } catch (error) {
    logger.error({ error, jobId: id, data }, "Error actualizando job");
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
          root_path: update.root_path
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

const jobWithEpisodeInclude = {
  episode: {
    include: {
      season: {
        include: {
          show: true,
        },
      },
    },
  },
} satisfies Prisma.JobInclude;

export type JobWithEpisode = Prisma.JobGetPayload<{ include: typeof jobWithEpisodeInclude }>;

export const jobWithDetailsInclude = {
  movie: true,
  episode: {
    include: {
      season: {
        include: {
          show: true,
        },
      },
    },
  },
} satisfies Prisma.JobInclude;

export type JobWithDetails = Prisma.JobGetPayload<{ include: typeof jobWithDetailsInclude }>;

export async function getNextToRip() {
  return prisma.job.findFirst({
    where: {
      downloadStatus: DownloadStatus.COMPLETED,
      encodeStatus: EncodeStatus.WAITING,
    },
    include: jobWithDetailsInclude,
    orderBy: {
      updatedAt: "asc",
    },
  });
}

export async function createJobFromFile(tmdbId: number, data: { rootPath: string; mediaType: MediaType, episodeId?: number }) {
  try {
    return await prisma.job.create({
      data: {
        tmdbId,
        root_path: data.rootPath,
        downloadStatus: DownloadStatus.COMPLETED,
        encodeStatus: EncodeStatus.WAITING,
        mediaType: data.mediaType,
        episodeId: data.episodeId,
      },
    });
  } catch (error) {
    logger.error({ error, tmdbId, data }, "Error creando job desde archivo");
    throw error;
  }
}

export async function createJobFromMagnet(
  tmdbId: number,
  data: {
    infoHash: string;
    mediaType: MediaType;
    episodeId?: number;
    movieId?: number;
  }
) {
  try {
    // Using upsert to prevent creating a duplicate job for the same media item.
    // If a job exists, we'll update it to retry the download with the new magnet.
    return await prisma.job.upsert({
      where: {
        tmdbId_mediaType: {
          tmdbId,
          mediaType: data.mediaType,
        },
      },
      update: {
        infoHash: data.infoHash,
        downloadStatus: DownloadStatus.ADDED, // Reset status to ADDED
        encodeStatus: EncodeStatus.WAITING,
        errorMessage: null,
        root_path: null, // Clear old path
      },
      create: { ...data, tmdbId, downloadStatus: DownloadStatus.ADDED },
    });
  } catch (error) {
    logger.error({ error, tmdbId, data }, "Error creating/updating job from magnet");
    throw error;
  }
}