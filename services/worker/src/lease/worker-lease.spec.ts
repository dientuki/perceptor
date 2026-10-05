import { describe, expect, it } from 'vitest';
import {
  LEASE_ACQUIRE_TIMEOUT_MS,
  LEASE_TTL_MS,
  RELEASE_SCRIPT,
  RENEW_SCRIPT,
  WORKER_LEASE_KEY,
  acquireWorkerLease,
  releaseWorkerLease,
  renewWorkerLease,
  tryAcquireWorkerLease,
  type LeaseRedis,
} from './worker-lease';

// The fake implements SET NX PX, GET and both guarded scripts against a virtual
// clock, so the holder comparison is exercised rather than assumed.
class FakeRedis implements LeaseRedis {
  private readonly entries = new Map<string, { value: string; expiresAt: number }>();

  constructor(private readonly clock: { now: number }) {}

  private live(key: string): { value: string; expiresAt: number } | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.clock.now) {
      this.entries.delete(key);
      return null;
    }
    return entry;
  }

  async set(
    key: string,
    value: string,
    _px: 'PX',
    ttlMs: number,
    _nx: 'NX',
  ): Promise<string | null> {
    if (this.live(key)) return null;
    this.entries.set(key, { value, expiresAt: this.clock.now + ttlMs });
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    return this.live(key)?.value ?? null;
  }

  async eval(
    script: string,
    _numKeys: number,
    ...args: Array<string | number>
  ): Promise<unknown> {
    const key = String(args[0]);
    const callerId = String(args[1]);
    const entry = this.live(key);

    if (script === RENEW_SCRIPT) {
      if (!entry || entry.value !== callerId) return 0;
      entry.expiresAt = this.clock.now + Number(args[2]);
      return 1;
    }

    if (script === RELEASE_SCRIPT) {
      if (!entry || entry.value !== callerId) return 0;
      this.entries.delete(key);
      return 1;
    }

    throw new Error(`unexpected script: ${script}`);
  }

  ttlOf(key: string): number | null {
    const entry = this.live(key);
    return entry ? entry.expiresAt - this.clock.now : null;
  }
}

// Defends the one-worker invariant Spec 054, NFR-4 recorded and left to the
// deployment: a second instance must be refused so it never reaches
// encodeWorkerStarted and never reconciles the first one's live encode. The
// cases that matter are the asymmetric ones — a worker killed hard must be able
// to retake its own expired lease (Docker restarts it in seconds, well inside
// the TTL), while a genuine second container must give up; and neither renew
// nor release may touch a lease the caller no longer holds, or a stalled worker
// would extend, or delete, the lease its successor is already running on.
describe('worker singleton lease', () => {
  it('grants the lease to the first instance and refuses the second', async () => {
    const clock = { now: 1_000 };
    const redis = new FakeRedis(clock);

    expect(await tryAcquireWorkerLease(redis, 'first')).toBe(true);
    expect(await tryAcquireWorkerLease(redis, 'second')).toBe(false);
    expect(await redis.get(WORKER_LEASE_KEY)).toBe('first');
  });

  it('gives up after the acquisition window when the holder stays alive', async () => {
    const clock = { now: 0 };
    const redis = new FakeRedis(clock);
    await tryAcquireWorkerLease(redis, 'first');

    const holders: Array<string | null> = [];
    const acquired = await acquireWorkerLease(redis, 'second', {
      timeoutMs: 9_000,
      retryMs: 3_000,
      now: () => clock.now,
      sleep: async (ms) => {
        clock.now += ms;
        await renewWorkerLease(redis, 'first');
      },
      onWait: (holder) => holders.push(holder),
    });

    expect(acquired).toBe(false);
    expect(holders).toEqual(['first', 'first', 'first']);
    expect(await redis.get(WORKER_LEASE_KEY)).toBe('first');
  });

  it('retakes the lease once a crashed holder stops renewing', async () => {
    const clock = { now: 0 };
    const redis = new FakeRedis(clock);
    await tryAcquireWorkerLease(redis, 'crashed');

    const acquired = await acquireWorkerLease(redis, 'restarted', {
      timeoutMs: LEASE_ACQUIRE_TIMEOUT_MS,
      retryMs: 3_000,
      now: () => clock.now,
      sleep: async (ms) => {
        clock.now += ms;
      },
    });

    expect(acquired).toBe(true);
    expect(await redis.get(WORKER_LEASE_KEY)).toBe('restarted');
    expect(clock.now).toBeGreaterThanOrEqual(LEASE_TTL_MS);
  });

  it('renews only for the holder, leaving its deadline untouched for anyone else', async () => {
    const clock = { now: 0 };
    const redis = new FakeRedis(clock);
    await tryAcquireWorkerLease(redis, 'holder');

    clock.now += 20_000;
    expect(await renewWorkerLease(redis, 'impostor')).toBe(false);
    expect(redis.ttlOf(WORKER_LEASE_KEY)).toBe(LEASE_TTL_MS - 20_000);

    expect(await renewWorkerLease(redis, 'holder')).toBe(true);
    expect(redis.ttlOf(WORKER_LEASE_KEY)).toBe(LEASE_TTL_MS);
  });

  it('refuses to renew a lease that already expired', async () => {
    const clock = { now: 0 };
    const redis = new FakeRedis(clock);
    await tryAcquireWorkerLease(redis, 'holder');

    clock.now += LEASE_TTL_MS;
    expect(await renewWorkerLease(redis, 'holder')).toBe(false);
  });

  it('releases only for the holder, and frees the lease immediately when it does', async () => {
    const clock = { now: 0 };
    const redis = new FakeRedis(clock);
    await tryAcquireWorkerLease(redis, 'holder');

    expect(await releaseWorkerLease(redis, 'impostor')).toBe(false);
    expect(await redis.get(WORKER_LEASE_KEY)).toBe('holder');

    expect(await releaseWorkerLease(redis, 'holder')).toBe(true);
    expect(await redis.get(WORKER_LEASE_KEY)).toBeNull();
    expect(await tryAcquireWorkerLease(redis, 'next')).toBe(true);
  });
});
