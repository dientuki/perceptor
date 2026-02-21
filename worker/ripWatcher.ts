// worker/torrentWatcher.ts
import { logger } from "@/lib/logger";
import { getNextToRip, update } from "@/models/jobs.model";
import { EncodeStatus } from "@prisma/client";
import { getMetadata } from "./ffmpeg/metadata";
import { getSetting } from "@/models/settings.model";
import { runFfmpeg } from "./ffmpeg/runner";
import { getVideoParams, getAudioParams, getSubtitleParams } from "./ffmpeg/params";
import { Job } from "@prisma/client";
import fs from 'fs';
import path from 'path';

let isWorking = false;
let interval: NodeJS.Timeout | null = null;
let path_movies: string;

function findMkvFile(dir: string): string | null {
  if (!fs.existsSync(dir)) return null;

  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isFile() && file.toLowerCase().endsWith('.mkv')) {
      return fullPath;
    }
  }
  return null;
}

export async function generateOutput(job: Job): Promise<string> {
  const { original_title, release_date } = job.tmdb;

  const cleanTitle = original_title
    .replace(/[:\-]/g, '')      // quitar ":" y "-"
    .replace(/\s+/g, ' ')       // reemplaza 2 o más espacios por uno solo
    .trim();                     // quitar espacios al inicio y al final

  // Sacar el año de release_date
  const year = release_date.slice(0, 4);

  // Nombre de la carpeta: título + año + tmdbid
  const folderName = `${cleanTitle} (${year}) [tmdbid=${job.tmdbId}]`;

  // Ruta completa de la carpeta
  const folderPath = path.join(path_movies, folderName);

  // Crear la carpeta si no existe
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }

  // Nombre final del archivo: título + año + .mkv
  const fileName = `${cleanTitle} (${year}).mkv`;

  // Full path final
  const fullPath = path.join(folderPath, fileName);

  return fullPath;
}

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
    //await update(nextToRip.tmdbId, { encodeStatus: EncodeStatus.QUEUED });

    const mkvFile = findMkvFile(nextToRip.content_path);
    logger.info({ mkvFile }, "🔍 Archivo MKV encontrado");
    
    const data = await getMetadata(mkvFile);
    const vStream = data.streams.find((s: any) => s.codec_type === "video");
    const aStreams = data.streams.filter((s: any) => s.codec_type === "audio");
    const sStreams = data.streams.filter((s: any) => s.codec_type === "subtitle"); 
    
    const outputName = await generateOutput(nextToRip);
    logger.info({ outputName }, "📁 Ruta de salida generada");
        
    const ffmpegArgs = [
      "-i", mkvFile,
      //"-t", "00:01:00", // Solo para pruebas, elimina esto después
      "-threads", "0",
      ...getVideoParams(vStream),
      ...getAudioParams(aStreams, nextToRip.tmdb.language.iso3),
      ...getSubtitleParams(sStreams, nextToRip.tmdb.language.iso3),
      "-map_metadata:g", "-1",
      "-y",
      outputName
    ];

    
    await update(nextToRip.tmdbId, { encodeStatus: EncodeStatus.ENCODING });
    await runFfmpeg(ffmpegArgs, outputName);
    await update(nextToRip.tmdbId, { encodeStatus: EncodeStatus.COMPLETED });
    
  } catch (error) {
    logger.error({ error }, "❌ Error en RipWatcher:");
  } finally {
    isWorking = false;
  }
}
