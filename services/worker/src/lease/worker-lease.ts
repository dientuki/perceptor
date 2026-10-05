// Perceptor runs exactly one worker container. Spec 054's boot reconciliation
// depends on it: announcing "I just started" is what lets the api conclude
// "nothing is encoding", and a second instance announcing that would reset a
// live encode belonging to the first. That was recorded as an invariant of the
// deployment and left unenforced; this module enforces it.
//
// Redis is the arbiter rather than Docker because the invariant is not "one
// container" but "one consumer of this queue" — two workers against the same
// Redis are the same pipeline and must exclude each other, two workers against
// different Redis instances are different installations and must not. A
// container name or a replica count gets both of those wrong, and sees neither
// `docker compose run` nor a dev stack pointed at a prod Redis.

import { randomUUID } from 'node:crypto';

export const WORKER_LEASE_KEY = 'perceptor:worker:lease';

export const LEASE_TTL_MS = 30_000;
export const LEASE_RENEW_INTERVAL_MS = 10_000;

// The acquisition window must outlast the lease itself: a worker killed hard
// is restarted by Docker within seconds and meets its own lease, still unexpired.
// 30s of TTL under a 60s window means the legitimate restart always gets in,
// and a genuine second container always gives up.
export const LEASE_ACQUIRE_TIMEOUT_MS = 60_000;
export const LEASE_ACQUIRE_RETRY_MS = 3_000;

// Both writes are guarded by the holder id: a worker that lost its lease (a GC
// pause longer than the TTL, a Redis failover) must never extend or delete the
// lease another instance has since taken.
export const RENEW_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end";

export const RELEASE_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

export interface LeaseRedis {
  set(key: string, value: string, px: 'PX', ttlMs: number, nx: 'NX'): Promise<string | null>;
  get(key: string): Promise<string | null>;
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
}

export interface AcquireLeaseOptions {
  timeoutMs?: number;
  retryMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  onWait?: (holder: string | null) => void;
}

export function newLeaseId(): string {
  return randomUUID();
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function tryAcquireWorkerLease(
  redis: LeaseRedis,
  leaseId: string,
): Promise<boolean> {
  const reply = await redis.set(WORKER_LEASE_KEY, leaseId, 'PX', LEASE_TTL_MS, 'NX');
  return reply === 'OK';
}

export async function renewWorkerLease(redis: LeaseRedis, leaseId: string): Promise<boolean> {
  const reply = await redis.eval(RENEW_SCRIPT, 1, WORKER_LEASE_KEY, leaseId, LEASE_TTL_MS);
  return Number(reply) === 1;
}

export async function releaseWorkerLease(redis: LeaseRedis, leaseId: string): Promise<boolean> {
  const reply = await redis.eval(RELEASE_SCRIPT, 1, WORKER_LEASE_KEY, leaseId);
  return Number(reply) === 1;
}

export async function acquireWorkerLease(
  redis: LeaseRedis,
  leaseId: string,
  options: AcquireLeaseOptions = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? LEASE_ACQUIRE_TIMEOUT_MS;
  const retryMs = options.retryMs ?? LEASE_ACQUIRE_RETRY_MS;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const deadline = now() + timeoutMs;

  for (;;) {
    if (await tryAcquireWorkerLease(redis, leaseId)) {
      return true;
    }

    if (now() >= deadline) {
      return false;
    }

    if (options.onWait) {
      options.onWait(await redis.get(WORKER_LEASE_KEY));
    }

    await sleep(retryMs);
  }
}
