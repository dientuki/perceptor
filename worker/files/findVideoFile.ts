import fs from "fs";
import path from "path";

export function findVideoFile(dir: string): string {
  if (!fs.existsSync(dir)) {
    throw new Error(`Directory does not exist: ${dir}`);
  }

  const videoFiles: { fullPath: string; size: number }[] = [];

  function traverse(currentPath: string) {
    const items = fs.readdirSync(currentPath);

    for (const item of items) {
      const fullPath = path.join(currentPath, item);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        traverse(fullPath);
      } else if (
        stat.isFile() &&
        [".mkv", ".mp4"].includes(path.extname(item).toLowerCase())
      ) {
        videoFiles.push({ fullPath, size: stat.size });
      }
    }
  }

  traverse(dir);

  if (videoFiles.length === 0) {
    throw new Error("No MKV or MP4 file found");
  }

  videoFiles.sort((a, b) => b.size - a.size);

  return videoFiles[0].fullPath;
}