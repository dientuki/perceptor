import type { EncodeFn } from './types';

// Portar acá services/worker/src/ffmpeg/: hoy no compila en este worker
// (imports del repo anterior — @/models/jobs.model, @/lib/logger, MediaType
// de @prisma/client que no existe en este schema) y tiene bugs propios
// documentados en el plan (runner.ts no resuelve ni rechaza la Promise si
// code===0 sin temp file; metadata.ts arma el comando de ffprobe con exec +
// interpolación de string en vez de execFile; SIGTERM no manejado; falta
// mkvmerge en el Dockerfile). Deliberadamente no implementado todavía.
export const encodeFfmpeg: EncodeFn = async () => {
  throw new Error(
    'ENCODE_DRIVER=ffmpeg todavía no está implementado (ver services/worker/src/ffmpeg/)',
  );
};
