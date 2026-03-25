import fs from "fs";
import path from "path";
import { JobWithDetails } from "@/models/jobs.model";

function sanitizeFilename(text: string): string {
  return text
    .replace(/[:\-']/g, "")
    .replace(/\s+/g, " ")
    .replace(/[<>:"/\\|?*]/g, "")
    .trim();
}

export function buildOutputPath(job: JobWithDetails & { root_path: string }, basePath: string): string {
  if (job.episode) {
    // episode: show (year) [tmdbid=1234]/Season XX/show SXXEXX title.mkv
    const show = job.episode.season.show;
    const season = job.episode.season;
    const episode = job.episode;

    const showName = sanitizeFilename(show.title);
    const year = show.releaseDate ? show.releaseDate.getFullYear().toString() : "0000";
    const tmdbId = show.tmdbId;

    const showFolder = `${showName} (${year}) [tmdbid=${tmdbId}]`;
    const seasonFolder = `Season ${season.seasonNumber.toString().padStart(2, "0")}`;

    const folderPath = path.join(basePath, showFolder, seasonFolder);
    fs.mkdirSync(folderPath, { recursive: true });

    const s = season.seasonNumber.toString().padStart(2, "0");
    const e = episode.episodeNumber.toString().padStart(2, "0");
    const episodeTitle = episode.title ? sanitizeFilename(episode.title) : "";

    const fileName = `${showName} S${s}E${e}${episodeTitle ? " " + episodeTitle : ""}.mkv`;

    return path.join(folderPath, fileName);
  }

  // movie: name (year) [tmdbid=1234]/name (year).mkv
  const title = job.movie?.title ?? `TMDB-${job.tmdbId}`;
  const cleanTitle = sanitizeFilename(title);
  const year = job.movie?.releaseDate ? new Date(job.movie.releaseDate).getFullYear().toString() : "0000";

  const folderName = `${cleanTitle} (${year}) [tmdbid=${job.tmdbId}]`;
  const folderPath = path.join(basePath, folderName);
  fs.mkdirSync(folderPath, { recursive: true });

  const fileName = `${cleanTitle} (${year}).mkv`;
  return path.join(folderPath, fileName);
}
