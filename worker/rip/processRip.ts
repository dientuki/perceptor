import { EncodeStatus } from "@prisma/client";
import { update } from "@/models/jobs.model";
import { getMetadata } from "../ffmpeg/metadata";
import { runFfmpeg } from "../ffmpeg/runner";
import { buildFfmpegCommand } from "../ffmpeg/buildCommand";
import { buildOutputPath } from "../files/buildOutputPath";
import { findMkvFile } from "../files/findMkv";
import { TorrentClient } from "@/clients/torrent/types";
import { JobReadyToRip } from "@/models/types";
import { createMediaServerClient } from "@/clients/mediaServer/createMediaServerClient";
import fs from "fs/promises";
import { logger } from "@/lib/logger";

export async function processRip(
  job: JobReadyToRip,
  moviesPath: string,
  torrentClient: TorrentClient
) {
  let mkvFile = job.root_path;

  // Si es un directorio (descarga de torrent), buscamos el archivo de video y actualizamos el job
  const stats = await fs.stat(mkvFile);
  if (stats.isDirectory()) {
    mkvFile = findMkvFile(job.root_path);
    
    if (mkvFile && mkvFile !== job.root_path) {
      logger.info({ jobId: job.id, oldPath: job.root_path, newPath: mkvFile }, "📂 Actualizando path del Job al archivo MKV detectado");
      await update(job.tmdbId, { root_path: mkvFile });
    }
  }

  const metadata = await getMetadata(mkvFile);

  const outputPath = buildOutputPath(job, moviesPath);

  const ffmpegArgs = buildFfmpegCommand(
    mkvFile,
    outputPath,
    metadata,
    job.tmdb.language.iso3
  );

  await update(job.tmdbId, { encodeStatus: EncodeStatus.ENCODING });

  await runFfmpeg(ffmpegArgs, outputPath);

  await update(job.tmdbId, { encodeStatus: EncodeStatus.COMPLETED });

  if (job.infoHash) {
    await torrentClient.remove(job.infoHash);
  }

  const mediaServerClient = await createMediaServerClient();
  await mediaServerClient.createdMedia(outputPath);
}