import { Worker } from 'bullmq';
import { PROCESS_QUEUE, SOURCE_READY_JOB, ENCODE_QUEUE, ENCODE_JOB } from './queue/types';
import type { SourceReadyJob, EncodeJob } from './queue/types';
import { handleSourceReady } from './jobs/source-ready.job';
import { handleEncode } from './jobs/encode.job';

// El container corre como PUID:PGID (ver docker-compose.yaml, "user:"), no
// root: sin esto el umask por defecto (022) deja carpetas 755/root y archivos
// 644, que Jellyfin (mismo grupo, pero otro uid) no puede escribir — necesita
// meter folder.jpg/.nfo/.trickplay adentro de cada carpeta que arma el
// worker. Con 002, sobre carpetas setgid (la biblioteca real ya lo tiene)
// queda 2775/664: mismo dueño de grupo, escribible por el grupo entero. Se
// hereda a ffmpeg/mkvmerge como hijos, así que no hace falta tocar runner.ts.
process.umask(0o002);

// Conexión con opciones planas, igual que los productores (process-queue.service.ts
// y encode-queue.service.ts en la api): BullMQ arma su propia conexión con los
// settings que necesita.
const connection = {
  host: process.env.REDIS_HOST ?? 'redis',
  port: Number(process.env.REDIS_PORT ?? 6379),
};

const scanWorker = new Worker<SourceReadyJob>(
  PROCESS_QUEUE,
  async (job) => {
    if (job.name !== SOURCE_READY_JOB) {
      console.log(`[worker] job desconocido ${job.name}, se ignora`);
      return;
    }

    await handleSourceReady(job);
  },
  {
    connection,
    // Un escaneo es IO sobre una carpeta y un encode no debe arrancar N veces
    // por accidente.
    concurrency: 1,
  },
);

// Worker separado, no un job name más en `process`: un encode puede tardar
// horas, y con concurrency:1 en una sola cola compartida o los escaneos
// quedan bloqueados detrás de FFmpeg, o se arriesgan N FFmpeg simultáneos.
// Cada Worker abre su propia conexión bloqueante, así que este puede estar
// horas ocupado sin frenar al de arriba.
const encodeWorker = new Worker<EncodeJob>(
  ENCODE_QUEUE,
  async (job) => {
    if (job.name !== ENCODE_JOB) {
      console.log(`[worker] job desconocido ${job.name}, se ignora`);
      return;
    }

    await handleEncode(job);
  },
  {
    connection,
    concurrency: 1,
  },
);

scanWorker.on('completed', (job) => {
  console.log(`[worker] completado ${job.id}`);
});

scanWorker.on('failed', (job, err) => {
  console.error(`[worker] falló ${job?.id}:`, err);
});

encodeWorker.on('completed', (job) => {
  console.log(`[worker] encode completado ${job.id}`);
});

encodeWorker.on('failed', (job, err) => {
  console.error(`[worker] encode falló ${job?.id}:`, err);
});

process.on('SIGTERM', () => {
  void scanWorker.close();
  void encodeWorker.close();
});

console.log('[worker] escuchando la cola', PROCESS_QUEUE);
console.log('[worker] escuchando la cola', ENCODE_QUEUE);
