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
import {
  LEASE_RENEW_INTERVAL_MS,
  acquireWorkerLease,
  newLeaseId,
  releaseWorkerLease,
  renewWorkerLease,
} from './lease/worker-lease';
import { reportEncodeWorkerStarted } from './api/encode-worker-started';
import { deliverReport } from './api/deliver-report';
import { fetchGraphQL } from './api/graphql-client';
import { ERROR_ENCODE_UNEXPECTED } from './i18n/error-keys';
import { renderMessage } from './i18n/messages.en';

process.umask(0o002);

const connection = {
  host: process.env.REDIS_HOST ?? 'redis',
  port: Number(process.env.REDIS_PORT ?? 6379),
};

// Spec 017, REQ-1 NFR-1
async function main() {
  // The gate comes before the announcement, not after: announcing is itself the
  // destructive act, so a second instance must be turned away while it still
  // has done nothing.

  // Spec 054, NFR-4
  const leaseClient = new Redis(connection);
  const leaseId = newLeaseId();
  const leaseAcquired = await acquireWorkerLease(leaseClient, leaseId, {
    onWait: (holder) =>
      console.log(`[worker] worker lease held by ${holder ?? 'another instance'}, retrying`),
  });

  if (!leaseAcquired) {
    console.error(
      '[worker] another worker already holds the singleton lease: Perceptor runs exactly one ' +
        'worker container, and a second one would reconcile the first one\'s live encodes. Exiting.',
    );
    await leaseClient.quit();
    process.exit(1);
  }

  // A failed renewal is logged, never fatal: a Redis blip is not worth killing a
  // multi-hour encode over, and an api unreachable through the same outage would
  // not be reconciling anything either.

  // Spec 054, NFR-4
  const leaseRenewal = setInterval(() => {
    void renewWorkerLease(leaseClient, leaseId)
      .then((renewed) => {
        if (!renewed) {
          console.error('[worker] worker lease renewal rejected, this instance no longer holds it');
        }
      })
      .catch((err) => {
        console.error('[worker] worker lease renewal failed:', err);
      });
  }, LEASE_RENEW_INTERVAL_MS);
  leaseRenewal.unref();

  // Spec 054, REQ-1 NFR-4
  const reconciledCount = await deliverReport('encodeWorkerStarted', () =>
    reportEncodeWorkerStarted(),
  );
  console.log(`[worker] encodeWorkerStarted: reconciled ${reconciledCount} orphaned job(s)`);

  const scanWorker = new Worker<SourceReadyJob>(
    PROCESS_QUEUE,
    async (job) => {
      if (job.name !== SOURCE_READY_JOB) {
        console.log(`[worker] unknown job ${job.name}, ignoring`);
        return;
      }

      await handleSourceReady(job);
    },
    {
      connection,
      concurrency: 1,
    },
  );

  const encodeWorker = new Worker<EncodeJob>(
    ENCODE_QUEUE,
    async (job) => {
      if (job.name !== ENCODE_JOB) {
        console.log(`[worker] unknown job ${job.name}, ignoring`);
        return;
      }

      await handleEncode(job);
    },
    {
      connection,
      concurrency: 1,
    },
  );

  // Spec 047, REQ-4
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
      console.error(`[worker] malformed cancellation message, discarding: ${message}`, err);
      return;
    }

    const cancelled = cancelEncode(parsed.processJobId);
    if (cancelled) {
      console.log(`[worker] cancellation applied to processJob ${parsed.processJobId}`);
    } else {
      console.log(`[worker] cancellation received for ${parsed.processJobId}, not running here`);
    }
  });

  scanWorker.on('completed', (job) => {
    console.log(`[worker] completed ${job.id}`);
  });

  scanWorker.on('failed', (job, err) => {
    console.error(`[worker] failed ${job?.id}:`, err);
  });

  encodeWorker.on('completed', (job) => {
    console.log(`[worker] encode completed ${job.id}`);
  });

  encodeWorker.on('failed', (job, err) => {
    console.error(`[worker] encode failed ${job?.id}:`, err);

    // Spec 054, REQ-10 REQ-8
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
        `[worker] could not report encodeFailed for exhausted retries (${job.data.processJobId}):`,
        reportErr,
      );
    });
  });

  process.on('SIGTERM', () => {
    void scanWorker.close();
    void encodeWorker.close();
    void cancelSubscriber.quit();

    // Releasing on the way out is what makes an orderly restart instant instead
    // of waiting out the TTL.

    // Spec 054, NFR-4
    clearInterval(leaseRenewal);
    void releaseWorkerLease(leaseClient, leaseId).finally(() => leaseClient.quit());
  });

  console.log('[worker] listening on queue', PROCESS_QUEUE);
  console.log('[worker] listening on queue', ENCODE_QUEUE);
  console.log('[worker] listening on channel', ENCODE_CANCEL_CHANNEL);
}

main().catch((error) => {
  console.error('[worker] fatal error during bootstrap:', error);
  process.exit(1);
});
