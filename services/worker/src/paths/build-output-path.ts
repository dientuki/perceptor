import { join } from 'node:path';

// Subconjunto de EncodeJobDetails (services/worker/src/jobs/encode.job.ts) que
// hace falta para armar la ruta — tipado acá en vez de importado para no atar
// este módulo, chico y sin efectos, a la forma completa de la query.
export type OutputPathInput = {
  kind: string; // 'MOVIE' | 'EPISODE'
  title: string;
  year: number | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
};

// Caracteres que rompen un nombre de archivo/carpeta en el filesystem del
// container (Linux) o en el share que Jellyfin lea después (SMB/Windows,
// donde ':' y compañía sí importan). Mejor sanear siempre.
const ILLEGAL_CHARS = /[<>:"/\\|?*\x00-\x1F]/g;

function sanitize(name: string): string {
  return name.replace(ILLEGAL_CHARS, '').trim();
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// Estructura que Jellyfin espera para detectar película/serie por carpeta:
// Movies/<Título> (<año>)/<Título> (<año>).mkv
// Shows/<Título> (<año>)/Season NN/<Título> - SNNENN.mkv
export function buildOutputPath(details: OutputPathInput): string {
  const root = process.env.DESTINATIONS_DIR;
  if (!root) throw new Error('DESTINATIONS_DIR no está definida');

  const titledFolder = sanitize(details.year ? `${details.title} (${details.year})` : details.title);

  if (details.kind === 'MOVIE') {
    return join(root, 'Movies', titledFolder, `${titledFolder}.mkv`);
  }

  if (details.seasonNumber === null || details.episodeNumber === null) {
    throw new Error('EPISODE sin seasonNumber/episodeNumber: no se puede armar la ruta de salida');
  }

  const seasonFolder = `Season ${pad2(details.seasonNumber)}`;
  const episodeFile = `${sanitize(details.title)} - S${pad2(details.seasonNumber)}E${pad2(details.episodeNumber)}.mkv`;

  return join(root, 'Shows', titledFolder, seasonFolder, episodeFile);
}
