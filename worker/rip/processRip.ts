import { EncodeStatus } from "@prisma/client";
import { update, JobWithDetails } from "@/models/jobs.model";
import { getMetadata } from "@/worker/ffmpeg/metadata";
import { runFfmpeg } from "@/worker/ffmpeg/runner";
import { buildFfmpegCommand } from "@/worker/ffmpeg/buildCommand";
import { buildOutputPath } from "@/worker/files/buildOutputPath";
import { findVideoFile } from "@/worker/files/findVideoFile";
import { TorrentClient } from "@/clients/torrent/types";
import fs from "fs/promises";
import { logger } from "@/lib/logger";
import { createMediaServerClient } from "@/clients/mediaServer/createMediaServerClient";
import { createJobFromFolderAction } from "@/actions/jobs";

export async function processRip(
  job: JobWithDetails & { root_path: string },
  path: string,
  torrentClient: TorrentClient
) {

  // Si el Job tiene un seasonId, es un pack de temporada completa
  if (job.seasonId) {
    logger.info({ jobId: job.id, seasonId: job.seasonId }, "📦 Detectado Job de temporada completa. Escaneando carpeta para crear Jobs individuales.");
    
    const showId = job.season?.showId;
    if (!showId) throw new Error("No se pudo determinar el showId para el pack de temporada.");

    // Usamos la acción existente para crear un job por cada MKV
    await createJobFromFolderAction(showId, job.seasonId, job.root_path);

    // Marcamos este job principal como completado
    await update(job.id, { encodeStatus: EncodeStatus.COMPLETED });

    if (job.infoHash) {
      await torrentClient.remove(job.infoHash, false);
    }
    
    return; // Salimos, no hay nada más que hacer con el pack en este worker
  }

  let mkvFile = job.root_path;

  // Si es un directorio (descarga de torrent), buscamos el archivo de video y actualizamos el job
  const stats = await fs.stat(mkvFile);
  if (stats.isDirectory()) {
    mkvFile = findVideoFile(job.root_path);
    
    if (mkvFile && mkvFile !== job.root_path) {
      logger.info({ jobId: job.id, oldPath: job.root_path, newPath: mkvFile }, "📂 Actualizando path del Job al archivo MKV detectado");
      await update(job.id, { root_path: mkvFile });
    }
  }

  const metadata = await getMetadata(mkvFile);
  
  const outputPath = buildOutputPath(job, path);

  const ffmpegArgs = await buildFfmpegCommand(
    mkvFile,
    outputPath,
    metadata,
    job
  );

  await update(job.id, { encodeStatus: EncodeStatus.ENCODING });

  await runFfmpeg(job.id, ffmpegArgs, outputPath);

  await update(job.id, { encodeStatus: EncodeStatus.COMPLETED });

  if (job.infoHash) {
    await torrentClient.remove(job.infoHash);
  }

  const mediaServerClient = await createMediaServerClient();
  await mediaServerClient.createdMedia(outputPath);
}