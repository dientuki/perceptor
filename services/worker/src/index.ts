import { UnrecoverableError, Worker } from 'bullmq';
import Redis from 'ioredis';
import {
  PROCESS_QUEUE,
  SOURCE_READY_JOB,
  ENCODE_QUEUE,
  ENCODE_JOB,
  ENCODE_CANCEL_CHANNEL,
} from './queue/types';
import type { SourceReadyJob, EncodeJob, EncodeCancelMessage } from './queue/types';
import { handleSourceReady } from './jobs/source-ready.job';
import { handleEncode } from './jobs/encode.job';
import { cancelEncode } from './encode/cancellation';
import { reportEncodeWorkerStarted } from './api/encode-worker-started';
import { deliverReport } from './api/deliver-report';
import { fetchGraphQL } from './api/graphql-client';
import { ERROR_ENCODE_UNEXPECTED } from './i18n/error-keys';
import { renderMessage } from './i18n/messages.en';

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

// This service is "type": "commonjs" — no top-level await. The probe result
// must be memoized before either Worker starts pulling encode jobs (REQ-1,
// NFR-1), so the whole startup is wrapped in this async bootstrap rather
// than switching the package to ESM as a side effect of this feature.
async function main() {
  // 054-interrupted-encode-recovery (REQ-1, NFR-4): sound only because exactly
  // one worker container runs — "I just booted" and "nothing is encoding" coincide.
  const reconciledCount = await deliverReport('encodeWorkerStarted', () =>
    reportEncodeWorkerStarted(),
  );
  console.log(`[worker] encodeWorkerStarted: reconciled ${reconciledCount} orphaned job(s)`);

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

  // 047-source-deletion: encode:cancel is a Redis pub/sub channel, not a
  // queue — only meaningful to a worker running the job right now, so no
  // separate BullMQ connection is warranted here, just a plain subscriber.
  const cancelSubscriber = new Redis(connection);
  await cancelSubscriber.subscribe(ENCODE_CANCEL_CHANNEL);

  cancelSubscriber.on('message', (_channel, message) => {
    let parsed: EncodeCancelMessage;
    try {
      parsed = JSON.parse(message) as EncodeCancelMessage;
      if (typeof parsed.processJobId !== 'number') {
        throw new Error('processJobId is not a number');
      }
    } catch (err) {
      console.error(`[worker] mensaje de cancelación malformado, se descarta: ${message}`, err);
      return;
    }

    const cancelled = cancelEncode(parsed.processJobId);
    if (cancelled) {
      console.log(`[worker] cancelación aplicada al processJob ${parsed.processJobId}`);
    } else {
      console.log(`[worker] cancelación recibida para ${parsed.processJobId}, no está corriendo acá`);
    }
  });

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

    // 054-interrupted-encode-recovery (REQ-10): this listener only reacts to
    // a BullMQ-level outcome, never to a plain diagnosed failure. If `err` is
    // an UnrecoverableError, encode.job.ts already decided whether to report
    // (KeyedError -> encodeFailed already sent; EncodeCancelledError ->
    // deliberately nothing, per REQ-8) before converting its error, so there
    // is nothing left to do here. Only an unclassified, still-plain throw
    // reaches this branch, and only once BullMQ has actually exhausted every
    // configured attempt (job.attemptsMade >= job.opts.attempts) does it mean
    // "nobody will retry this" rather than "a retry is already queued" — the
    // latter must never be reported, or a title would turn red while its
    // encode is still coming.
    if (err instanceof UnrecoverableError) return;
    if (!job) return;

    const attempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < attempts) return;

    const detail = err instanceof Error ? err.message : String(err);
    const errorKey = ERROR_ENCODE_UNEXPECTED;
    const errorMessage = renderMessage(errorKey, { detail });

    void deliverReport(`encodeFailed(exhausted:${job.data.processJobId})`, () =>
      fetchGraphQL(
        `mutation ($id: Int!, $key: String!, $params: String, $msg: String!) {
          encodeFailed(processJobId: $id, errorKey: $key, errorParams: $params, errorMessage: $msg)
        }`,
        {
          id: job.data.processJobId,
          key: errorKey,
          params: JSON.stringify({ detail }),
          msg: errorMessage,
        },
      ),
    ).catch((reportErr) => {
      console.error(
        `[worker] no se pudo reportar encodeFailed por agotamiento de reintentos (${job.data.processJobId}):`,
        reportErr,
      );
    });
  });

  process.on('SIGTERM', () => {
    void scanWorker.close();
    void encodeWorker.close();
    void cancelSubscriber.quit();
  });

  console.log('[worker] escuchando la cola', PROCESS_QUEUE);
  console.log('[worker] escuchando la cola', ENCODE_QUEUE);
  console.log('[worker] escuchando el canal', ENCODE_CANCEL_CHANNEL);
}

main().catch((error) => {
  console.error('[worker] fatal error en el bootstrap:', error);
  process.exit(1);
});
