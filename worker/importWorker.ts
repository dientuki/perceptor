import { getSetting } from "@/models/settings.model";
import fs from "fs/promises";
import pathLib from "path";
import { getMetadata } from "./ffmpeg/metadata";
import { buildFfmpegCommand } from "./ffmpeg/buildCommand";
import { buildSerieOutputPath, buildEpisodeOutputPath } from "./files/buildOutputPath";
import { runFfmpeg } from "./ffmpeg/runner";

type TriggerImportParams = {
  path: string;
  tmdbData: {
    id: number;
    first_air_date: string;
    name: string;
    original_language: string;
  };
  season: number;
  episodes: number[];
};

async function findMkvFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  // Usamos flatMap para combinar archivos de subcarpetas
  const mkvFiles = await Promise.all(entries.map(async (entry) => {
    const fullPath = pathLib.join(dir, entry.name);

    if (entry.isDirectory()) {
      // Llamada recursiva a subcarpeta
      return await findMkvFiles(fullPath);
    } else if (entry.isFile() && pathLib.extname(entry.name).toLowerCase() === ".mkv") {
      return fullPath;
    } else {
      return []; // No es carpeta ni mkv
    }
  }));

  // Aplanamos el array porque Promise.all devuelve un array de arrays
  return mkvFiles.flat();
}

export async function triggerImportWorker({
  path,
  tmdbData,
  season,
  episodes,
}: TriggerImportParams) {
  const paths = await getSetting(["path_shows"]) as Record<string, string>;
  const path_shows = paths.path_shows;

  console.log("📥 Import Triggered");
  console.log("Path:", path);
  console.log("Serie:", tmdbData.name);
  console.log("First Air:", tmdbData.first_air_date);
  console.log("Language:", tmdbData.original_language);
  console.log("Season:", season);
  console.log("Episodes:", episodes);

  //sudo chmod -R g+rwX Shows/ Movies/


  const entries = await fs.readdir(path, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile());
  const mkvFiles = files.filter((file) =>
    pathLib.extname(file.name).toLowerCase() === ".mkv"
  );

  console.log(`Found ${mkvFiles.length} MKV files`);

  if (mkvFiles.length === 0) {
    console.log("⚠️ No MKV files found. Nothing to process.");
    return;
  }

  for (const file of files) {
    const mkvFile = pathLib.join(path, file.name);
    const metadata = await getMetadata(mkvFile);

    const seasonPath = await buildSerieOutputPath(tmdbData, path_shows, season);
    const episodeOutputPath = buildEpisodeOutputPath(seasonPath, mkvFile, tmdbData.name, season, episodes);
    //console.log(seasonPath, episodeOutputPath);
    //return;

    //console.log("Processing:", file.name);

    const ffmpegArgs = buildFfmpegCommand(
        mkvFile,
        episodeOutputPath,
        metadata,
        'eng'
      );

    console.log(seasonPath, episodeOutputPath);

    await runFfmpeg(ffmpegArgs, episodeOutputPath);
  }

  // acá después va tu lógica real de import
}