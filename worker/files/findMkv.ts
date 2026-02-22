import fs from "fs";
import path from "path";

export function findMkvFile(dir: string): string {
  if (!fs.existsSync(dir)) {
    throw new Error(`Directory does not exist: ${dir}`);
  }

  const files = fs.readdirSync(dir);

  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    if (stat.isFile() && file.toLowerCase().endsWith(".mkv")) {
      return fullPath;
    }
  }

  throw new Error("No MKV file found");
}