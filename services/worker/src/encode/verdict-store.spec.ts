import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  VERDICT_CALL_TIMEOUT_MS,
  VERDICT_TTL_SECONDS,
  fileIdentity,
  installVerdictStore,
  readVerdict,
  verdictKey,
  writeVerdict,
  type VerdictRedis,
} from './verdict-store';

// Defends against a verdict store that hangs or fails an encode when Redis is
// down or slow, and against a key written with no expiry under noeviction,
// which would fill Redis until every later write failed with no error anywhere.
class FakeRedis implements VerdictRedis {
  readonly entries = new Map<string, string>();
  readonly sets: Array<{ key: string; value: string; ex: string; seconds: number }> = [];
  calls = 0;

  async get(key: string): Promise<string | null> {
    this.calls += 1;
    return this.entries.get(key) ?? null;
  }

  async set(key: string, value: string, ex: 'EX', seconds: number): Promise<unknown> {
    this.calls += 1;
    this.sets.push({ key, value, ex, seconds });
    this.entries.set(key, value);
    return 'OK';
  }
}

afterEach(() => {
  installVerdictStore(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const identity = { path: '/downloads/a.mkv', size: 10, mtimeMs: 5 };

describe('verdict store', () => {
  it('round-trips a stored verdict', async () => {
    installVerdictStore(new FakeRedis());
    await writeVerdict('dubtrim', identity, 1234.5);
    expect(await readVerdict<number>('dubtrim', identity)).toBe(1234.5);
  });

  it('resolves a miss, not a throw, when Redis rejects', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const rejecting: VerdictRedis = {
      get: () => Promise.reject(new Error('down')),
      set: () => Promise.reject(new Error('down')),
    };
    installVerdictStore(rejecting);
    expect(await readVerdict('grain', identity)).toBeUndefined();
    await expect(writeVerdict('grain', identity, true)).resolves.toBeUndefined();
  });

  it('resolves as a miss when Redis never answers', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const silent: VerdictRedis = {
      get: () => new Promise(() => undefined),
      set: () => new Promise(() => undefined),
    };
    installVerdictStore(silent);
    const read = readVerdict('subs', identity);
    const write = writeVerdict('subs', identity, ['x']);
    await vi.advanceTimersByTimeAsync(VERDICT_CALL_TIMEOUT_MS + 1);
    expect(await read).toBeUndefined();
    await expect(write).resolves.toBeUndefined();
  });

  it('treats an unparsable stored value as a miss', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const redis = new FakeRedis();
    redis.entries.set(verdictKey('grain', identity), '{not json');
    installVerdictStore(redis);
    expect(await readVerdict('grain', identity)).toBeUndefined();
  });

  it('sets the 30-day expiry in the same command on every write', async () => {
    const redis = new FakeRedis();
    installVerdictStore(redis);
    await writeVerdict('grain', identity, true);
    await writeVerdict('streamtrim', identity, null);
    await writeVerdict('assembly', { path: '/x' }, { size: 1, mtimeMs: 2 });
    expect(redis.sets).toHaveLength(3);
    for (const set of redis.sets) {
      expect(set.ex).toBe('EX');
      expect(set.seconds).toBe(2_592_000);
    }
    expect(VERDICT_TTL_SECONDS).toBe(2_592_000);
  });

  it('misses and drops writes silently when nothing is installed', async () => {
    installVerdictStore(null);
    expect(await readVerdict('grain', identity)).toBeUndefined();
    await expect(writeVerdict('grain', identity, true)).resolves.toBeUndefined();
  });

  it('makes no Redis call at all for a null identity', async () => {
    const redis = new FakeRedis();
    installVerdictStore(redis);
    expect(await readVerdict('dubtrim', null)).toBeUndefined();
    await writeVerdict('dubtrim', null, 3);
    expect(redis.calls).toBe(0);
  });

  it('builds the same key for the same identity in a different key order', () => {
    const a = verdictKey('subs', { path: '/a', size: 1, nested: { x: 1, y: 2 }, streams: [3, 1] });
    const b = verdictKey('subs', { streams: [3, 1], nested: { y: 2, x: 1 }, size: 1, path: '/a' });
    expect(a).toBe(b);
    expect(a).toMatch(/^perceptor:encode:subs:[0-9a-f]{40}$/);
  });

  it('builds a different key when the size, the kind or the array order differs', () => {
    const base = verdictKey('grain', identity);
    expect(verdictKey('grain', { ...identity, size: 11 })).not.toBe(base);
    expect(verdictKey('dubtrim', identity)).not.toBe(base);
    expect(verdictKey('subs', { streams: [1, 2] })).not.toBe(verdictKey('subs', { streams: [2, 1] }));
  });

  it('returns null identity for a file that cannot be read', async () => {
    expect(await fileIdentity('/nonexistent/perceptor/file.mkv')).toBeNull();
  });
});
