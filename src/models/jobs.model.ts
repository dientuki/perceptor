import { prisma } from "@/lib/prisma";
import { DownloadStatus, EncodeStatus, MediaType, Prisma, JobStatus, Job } from "@prisma/client";
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
    root_path?: string | null;
    ffmpegCommand?: string;
    seasonId?: number | null;
  }
): Promise<Job> {
  try {
    const updatedJob = await prisma.$transaction(async (tx) => {
      // 1. Get the current job state to resolve the final jobStatus
      // We need to select all fields that might be affected by the update,
      // and also the related movie/episode IDs.
      const currentJob = await tx.job.findUnique({
        where: { id },
        select: {
          downloadStatus: true,
          encodeStatus: true,
          mediaType: true,
          movieId: true,
          episodeId: true,
        },
      });

      if (!currentJob) {
        throw new Error(`Job with ID ${id} not found.`);
      }

      // 2. Update the job itself
      const job = await tx.job.update({
        where: { id },
        data,
      });

      // 3. Resolve the new overall jobStatus for the related Movie/Episode
      const newOverallJobStatus = resolveJobStatus(
        data.downloadStatus ?? currentJob.downloadStatus, // Use new status if provided, else current
        data.encodeStatus ?? currentJob.encodeStatus      // Use new status if provided, else current
      );

      // 4. Update the related Movie or Episode's jobStatus
      if (job.mediaType === MediaType.MOVIE && job.movieId) {
        await tx.movie.update({
          where: { id: job.movieId },
          data: { jobStatus: newOverallJobStatus },
        });
      } else if (job.mediaType === MediaType.TV && job.episodeId) {
        await tx.episode.update({
          where: { id: job.episodeId },
          data: { jobStatus: newOverallJobStatus },
        });
      }
      return job;
    });

    return updatedJob;
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

export function resolveJobStatus(
  downloadStatus: DownloadStatus,
  encodeStatus: EncodeStatus
): JobStatus {
    // 1️⃣ Si hay error en cualquiera
  if (
    downloadStatus === DownloadStatus.ERROR ||
    encodeStatus === EncodeStatus.ERROR
  ) {
    return JobStatus.ERROR;
  }

  // 2️⃣ Si ambos completados
  if (
    downloadStatus === DownloadStatus.COMPLETED &&
    encodeStatus === EncodeStatus.COMPLETED
  ) {
    return JobStatus.COMPLETED;
  }

  if (
    downloadStatus === DownloadStatus.CREATED &&
    encodeStatus === EncodeStatus.WAITING
  ) {
    return JobStatus.CREATED;
  }

  if (downloadStatus === DownloadStatus.ADDED || downloadStatus === DownloadStatus.SEARCHING) {
    return JobStatus.DOWNLOADING;
  }

  if (downloadStatus === DownloadStatus.DOWNLOADING || downloadStatus === DownloadStatus.PAUSED) {
    return downloadStatus;
  }

  if (encodeStatus === EncodeStatus.WAITING || encodeStatus === EncodeStatus.QUEUED) {
    return JobStatus.QUEUED;
  }

  if ( encodeStatus === EncodeStatus.ENCODING) {
    return JobStatus.ENCODING;
  }

  return JobStatus.ERROR;
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
  season: true,
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

export async function createJobFromFile(tmdbId: number, data: { rootPath: string; mediaType: MediaType, episodeId?: number, movieId?: number }) {
  try {
    // Buscamos si ya existe un job para este ítem específico
    const existingJob = await prisma.job.findFirst({
      where: data.mediaType === MediaType.TV 
        ? { episodeId: data.episodeId } 
        : { movieId: data.movieId }
    });

    const jobData = {
      tmdbId,
      root_path: data.rootPath,
      downloadStatus: DownloadStatus.COMPLETED,
      encodeStatus: EncodeStatus.WAITING,
      mediaType: data.mediaType,
      errorMessage: null,
      episodeId: data.episodeId ?? null,
      movieId: data.movieId ?? null,
    };

    if (existingJob) {
      return await update(existingJob.id, {
        root_path: jobData.root_path,
        downloadStatus: jobData.downloadStatus,
        encodeStatus: jobData.encodeStatus,
        errorMessage: jobData.errorMessage,
      });
    }

    return await prisma.$transaction(async (tx) => {
      const job = await tx.job.create({
        data: jobData,
      });

      const newOverallJobStatus = resolveJobStatus(jobData.downloadStatus, jobData.encodeStatus);
      logger.info({ jobId: job.id, status: newOverallJobStatus }, "Nuevo estado consolidado del job");

      if (job.mediaType === MediaType.MOVIE && job.movieId) {
        await tx.movie.update({
          where: { id: job.movieId },
          data: { jobStatus: newOverallJobStatus },
        });
      } else if (job.mediaType === MediaType.TV && job.episodeId) {
        await tx.episode.update({
          where: { id: job.episodeId },
          data: { jobStatus: newOverallJobStatus },
        });
      }
      return job;
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
    seasonId?: number;
  }
) {
  try {
    const existingJob = await prisma.job.findFirst({
      where: data.mediaType === MediaType.TV 
        ? (data.seasonId ? { seasonId: data.seasonId } : { episodeId: data.episodeId })
        : { movieId: data.movieId }
    });

    const jobData = {
      tmdbId,
      infoHash: data.infoHash,
      mediaType: data.mediaType,
      downloadStatus: DownloadStatus.ADDED,
      encodeStatus: EncodeStatus.WAITING,
      errorMessage: null,
      root_path: null,
      episodeId: data.episodeId ?? null,
      movieId: data.movieId ?? null,
      seasonId: data.seasonId ?? null,
    };

    if (existingJob) {
      return await update(existingJob.id, {
        infoHash: jobData.infoHash,
        downloadStatus: jobData.downloadStatus,
        encodeStatus: jobData.encodeStatus,
        errorMessage: jobData.errorMessage,
        root_path: jobData.root_path,
        seasonId: jobData.seasonId,
      });
    }

    return await prisma.$transaction(async (tx) => {
      const job = await tx.job.create({
        data: jobData,
      });

      const newOverallJobStatus = resolveJobStatus(jobData.downloadStatus, jobData.encodeStatus);

      if (job.mediaType === MediaType.MOVIE && job.movieId) {
        await tx.movie.update({
          where: { id: job.movieId },
          data: { jobStatus: newOverallJobStatus },
        });
      } else if (job.mediaType === MediaType.TV && job.episodeId) {
        await tx.episode.update({
          where: { id: job.episodeId },
          data: { jobStatus: newOverallJobStatus },
        });
      }
      return job;
    });
  } catch (error) {
    logger.error({ error, tmdbId, data }, "Error creando/actualizando job desde magnet");
    throw error;
  }
}

/**
 * Resetea los jobs que quedaron en estado ENCODING (probablemente por una caída del worker)
 * devolviéndolos a WAITING para que el RipWatcher los vuelva a procesar.
 */
export async function resetEncodingJobs() {
  try {
    const { count } = await prisma.job.updateMany({
      where: {
        downloadStatus: DownloadStatus.COMPLETED,
        encodeStatus: EncodeStatus.ENCODING,
      },
      data: {
        encodeStatus: EncodeStatus.WAITING,
      },
    });

    logger.info({ count }, "🔄 Se han reseteado jobs interrumpidos durante el encoding");
  } catch (error) {
    logger.error({ error }, "❌ Error al resetear jobs interrumpidos");
    throw error;
  }
}