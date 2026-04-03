import fs from "fs";
import path from "path";

export function findVideoFile(dir: string): string {
  if (!fs.existsSync(dir)) {
    throw new Error(`Directory does not exist: ${dir}`);
  }

  const files = fs.readdirSync(dir);

  const videoFiles = files
    .map((file) => {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);

      return {
        file,
        fullPath,
        stat,
      };
    })
    .filter(
      ({ file, stat }) =>
        stat.isFile() &&
        [".mkv", ".mp4"].includes(path.extname(file).toLowerCase())
    )
    .sort((a, b) => b.stat.size - a.stat.size);

  if (videoFiles.length === 0) {
    throw new Error("No MKV or MP4 file found");
  }

  return videoFiles[0].fullPath;
}