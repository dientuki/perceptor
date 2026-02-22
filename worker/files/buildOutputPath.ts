import fs from "fs";
import path from "path";
import { Job } from "@prisma/client";

export function buildOutputPath(job: Job, basePath: string): string {
  const { original_title, release_date } = job.tmdb;

  const cleanTitle = original_title
    .replace(/[:\-]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const year = release_date.slice(0, 4);

  const folderName = `${cleanTitle} (${year}) [tmdbid=${job.tmdbId}]`;
  const folderPath = path.join(basePath, folderName);

  fs.mkdirSync(folderPath, { recursive: true });

  const fileName = `${cleanTitle} (${year}).mkv`;

  return path.join(folderPath, fileName);
}