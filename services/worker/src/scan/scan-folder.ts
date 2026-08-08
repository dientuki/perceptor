import { readdir, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

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
  const rootStats = await stat(root);

  // downloadPath normalmente es una carpeta (el savepath por torrent que arma
  // la api), pero para SourceKind.LOCAL_FILE es la ruta de un archivo suelto —
  // readdir tira ENOTDIR en ese caso. Un archivo único entra igual al mismo
  // filtro de abajo: si no es video, matchedFilePath sale null y sourceScanned
  // lo reporta como el mismo ERROR que una carpeta sin video.
  const files: ScannedFile[] = rootStats.isFile()
    ? [{ filePath: root, fileName: basename(root), size: rootStats.size }]
    : await enumerateFolder(root);

  // Sin parseo de nombres en esta etapa: el candidato es el video más grande.
  const matched = files
    .filter((f) => VIDEO_EXTENSIONS.includes(extname(f.fileName).toLowerCase()))
    .sort((a, b) => b.size - a.size)[0];

  return { files, matchedFilePath: matched?.filePath ?? null };
}

async function enumerateFolder(root: string): Promise<ScannedFile[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });

  const files: ScannedFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;

    const filePath = join(entry.parentPath, entry.name);
    const stats = await stat(filePath);

    files.push({ filePath, fileName: entry.name, size: stats.size });
  }

  return files;
}
