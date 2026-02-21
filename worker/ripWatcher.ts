// worker/torrentWatcher.ts
import { logger } from "@/lib/logger";
import { getNextToRip, update } from "@/models/jobs.model";
import { EncodeStatus } from "@prisma/client";
import { getMetadata } from "./ffmpeg/metadata";
import { getSetting } from "@/models/settings.model";
import { runFfmpeg } from "./ffmpeg/runner";
import { getVideoParams, getAudioParams, getSubtitleParams } from "./ffmpeg/params";

let isWorking = false;
let interval: NodeJS.Timeout | null = null;
let path_movies: string;

export async function startRipWatcher() {
  logger.info("👀 RipWatcher iniciando...");

  const paths = await getSetting([
    "path_movies",
    "path_downloads",
  ]) as Record<string, string>;

  path_movies = paths.path_movies;
  //path_downloads = paths.path_downloads;

  interval = setInterval(runCheck, 5000);
}

async function runCheck() {
  if (isWorking) return;
  logger.info("🔄 Revisando torrents descargados...");
  isWorking = true;

  const nextToRip = await getNextToRip();

  if (!nextToRip) return;

  try {
    logger.info({ nextToRip }, "📦 Encontrado torrent para rippear");
    await update(nextToRip.tmdbId, { encodeStatus: EncodeStatus.QUEUED });

    const data = await getMetadata(job.filename);
    const vStream = data.streams.find((s: any) => s.codec_type === "video");
    const aStreams = data.streams.filter((s: any) => s.codec_type === "audio");
    const sStreams = data.streams.filter((s: any) => s.codec_type === "subtitle"); 
    
    const outputName = job.filename.replace(".mkv", "_av1.mkv");
    
          const ffmpegArgs = [
            "-i", job.filename,
            "-t", "00:01:00", // Solo para pruebas, elimina esto después
            ...getVideoParams(vStream),
            ...getAudioParams(aStreams, job.language),
            ...getSubtitleParams(sStreams, job.language),
            "-map_metadata:g", "-1",
            "-y",
            outputName
          ];

    await runFfmpeg(ffmpegArgs, outputName);

  } catch (error) {
    logger.error({ error }, "❌ Error en RipWatcher:");
  } finally {
    isWorking = false;
  }
}
