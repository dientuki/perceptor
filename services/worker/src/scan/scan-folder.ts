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

// Enumera (no parsea): readdir + extensión + tamaño. Sin temporada, episodio,
// calidad ni selección de candidato — esa distinción es de un paso posterior
// (src/scan/select-matches.ts), que decide qué archivos son candidatos y cómo
// se resuelven contra episodios.
export async function scanFolder(root: string): Promise<ScanResult> {
  const rootStats = await stat(root);

  // downloadPath normalmente es una carpeta (el savepath por torrent que arma
  // la api), pero para SourceKind.LOCAL_FILE es la ruta de un archivo suelto —
  // readdir tira ENOTDIR en ese caso. Un archivo único entra igual al mismo
  // inventario, marcado con su propio isVideo.
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
