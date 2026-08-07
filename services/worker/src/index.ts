import { Worker } from 'bullmq';
import { PROCESS_QUEUE, SOURCE_READY_JOB } from './queue/types';
import type { SourceReadyJob } from './queue/types';
import { handleSourceReady } from './jobs/source-ready.job';

// Conexión con opciones planas, igual que el productor (process-queue.service.ts
// en la api): BullMQ arma su propia conexión con los settings que necesita.
const worker = new Worker<SourceReadyJob>(
  PROCESS_QUEUE,
  async (job) => {
    if (job.name !== SOURCE_READY_JOB) {
      console.log(`[worker] job desconocido ${job.name}, se ignora`);
      return;
    }

    await handleSourceReady(job);
  },
  {
    connection: {
      host: process.env.REDIS_HOST ?? 'redis',
      port: Number(process.env.REDIS_PORT ?? 6379),
    },
    // Un escaneo es IO sobre una carpeta y FFmpeg (paso siguiente) no debe
    // arrancar N veces por accidente.
    concurrency: 1,
  },
);

worker.on('completed', (job) => {
  console.log(`[worker] completado ${job.id}`);
});

worker.on('failed', (job, err) => {
  console.error(`[worker] falló ${job?.id}:`, err);
});

process.on('SIGTERM', () => void worker.close());

console.log('[worker] escuchando la cola', PROCESS_QUEUE);
