import { readdir, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

const VIDEO_EXTENSIONS = ['.mkv', '.mp4', '.avi', '.m4v', '.mov', '.wmv', '.ts', '.webm'];

export type ScannedFile = {
  filePath: string;
  fileName: string;
  size: number;
  isVideo: boolean;
};

export type ScanResult = {
  files: ScannedFile[];
};

export async function scanFolder(root: string): Promise<ScanResult> {
  const rootStats = await stat(root);

  const files: ScannedFile[] = rootStats.isFile()
    ? [
        {
          filePath: root,
          fileName: basename(root),
          size: rootStats.size,
          isVideo: isVideoFile(basename(root)),
        },
      ]
    : await enumerateFolder(root);

  return { files };
}

function isVideoFile(fileName: string): boolean {
  return VIDEO_EXTENSIONS.includes(extname(fileName).toLowerCase());
}

async function enumerateFolder(root: string): Promise<ScannedFile[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });

  const files: ScannedFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;

    const filePath = join(entry.parentPath, entry.name);
    const stats = await stat(filePath);

    files.push({ filePath, fileName: entry.name, size: stats.size, isVideo: isVideoFile(entry.name) });
  }

  return files;
}
