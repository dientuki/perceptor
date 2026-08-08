import { join } from 'node:path';

// Subconjunto de EncodeJobDetails (services/worker/src/jobs/encode.job.ts) que
// hace falta para armar la ruta — tipado acá en vez de importado para no atar
// este módulo, chico y sin efectos, a la forma completa de la query.
export type OutputPathInput = {
  kind: string; // 'MOVIE' | 'EPISODE'
  tmdbId: number;
  title: string;
  year: number | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  episodeTitle: string | null;
};

// Reglas portadas tal cual de services/worker/src/ffmpeg/buildOutputPath.ts
// (referencia del repo viejo) — verificadas contra la biblioteca real:
// "Alita: Battle Angel" -> "Alita Battle Angel", "X-Men: First Class" ->
// "XMen First Class", "Lisey's Story" -> "Liseys Story". Dos puntos, guiones y
// apóstrofes se sacan (no sólo reemplazan por espacio); "&" y "." se
// mantienen ("Dungeons & Dragons...", "The Super Mario Bros. Movie").
function sanitize(name: string): string {
  return name
    .replace(/[:\-']/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .trim();
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// Estructura que Jellyfin espera para detectar película/serie por carpeta,
// con [tmdbid=] para matching preciso en vez de confiar en el nombre — sólo
// en la carpeta, nunca en el archivo (confirmado contra la biblioteca real:
// "Avengers Endgame (2019) [tmdbid=299534]/Avengers Endgame (2019).mkv"):
// Movies/<Título> (<año>) [tmdbid=<id>]/<Título> (<año>).mkv
// Shows/<Título> (<año>) [tmdbid=<id>]/Season NN/<Título> SNNENN <ep título>.mkv
export function buildOutputPath(details: OutputPathInput): string {
  const root = process.env.DESTINATIONS_DIR;
  if (!root) throw new Error('DESTINATIONS_DIR no está definida');

  const cleanTitle = sanitize(details.title);
  // '0000' en vez de omitir el año cuando no se conoce: mismo comportamiento
  // que el repo viejo, mantiene la carpeta parseable por Jellyfin.
  const year = details.year ? String(details.year) : '0000';
  const titledFolder = `${cleanTitle} (${year}) [tmdbid=${details.tmdbId}]`;

  if (details.kind === 'MOVIE') {
    return join(root, 'Movies', titledFolder, `${cleanTitle} (${year}).mkv`);
  }

  if (details.seasonNumber === null || details.episodeNumber === null) {
    throw new Error('EPISODE sin seasonNumber/episodeNumber: no se puede armar la ruta de salida');
  }

  const seasonFolder = `Season ${pad2(details.seasonNumber)}`;
  const episodeTitle = details.episodeTitle ? sanitize(details.episodeTitle) : '';
  const episodeFile = `${cleanTitle} S${pad2(details.seasonNumber)}E${pad2(details.episodeNumber)}${episodeTitle ? ` ${episodeTitle}` : ''}.mkv`;

  return join(root, 'Shows', titledFolder, seasonFolder, episodeFile);
}
