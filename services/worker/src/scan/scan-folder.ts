import { readdir, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';

const VIDEO_EXTENSIONS = ['.mkv', '.mp4', '.avi', '.m4v', '.mov', '.wmv', '.ts', '.webm'];

export type ScannedFile = {
  filePath: string;
  fileName: string;
  size: number;
};

export type ScanResult = {
  files: ScannedFile[];
  matchedFilePath: string | null;
};

// Enumera (no parsea): readdir + extensión + tamaño. Sin temporada, episodio,
// calidad ni descarte de samples — esa distinción es la que mantiene el paso chico.
export async function scanFolder(root: string): Promise<ScanResult> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });

  const files: ScannedFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;

    const filePath = join(entry.parentPath, entry.name);
    const stats = await stat(filePath);

    files.push({ filePath, fileName: entry.name, size: stats.size });
  }

  // Sin parseo de nombres en esta etapa: el candidato es el video más grande.
  const matched = files
    .filter((f) => VIDEO_EXTENSIONS.includes(extname(f.fileName).toLowerCase()))
    .sort((a, b) => b.size - a.size)[0];

  return { files, matchedFilePath: matched?.filePath ?? null };
}
