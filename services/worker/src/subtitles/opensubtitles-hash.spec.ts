// Defends against a wrong OpenSubtitles hash, which makes every lookup miss
// with no error, and against a probe that opens a library file writable.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as fsp from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { opensubtitlesHash } from './opensubtitles-hash';

vi.mock('node:fs/promises', async (orig) => {
  const actual = await orig<typeof import('node:fs/promises')>();
  return { ...actual, open: vi.fn(actual.open) };
});

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'osh-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  vi.clearAllMocks();
});

function expected(buf: Buffer): string {
  const mask = (1n << 64n) - 1n;
  let sum = BigInt(buf.length);
  const head = buf.subarray(0, 65536);
  const tail = buf.subarray(buf.length - 65536);
  for (const c of [head, tail]) {
    for (let i = 0; i + 8 <= c.length; i += 8) sum = (sum + c.readBigUInt64LE(i)) & mask;
  }
  return sum.toString(16).padStart(16, '0');
}

describe('opensubtitlesHash', () => {
  it('matches an independently computed hash over two known 64 KiB chunks', async () => {
    const buf = Buffer.alloc(200000);
    for (let i = 0; i < buf.length; i++) buf[i] = (i * 31 + 7) & 0xff;
    buf.fill(0xff, 0, 65536);
    const path = join(dir, 'a.mkv');
    await writeFile(path, buf);
    const result = await opensubtitlesHash(path);
    expect(result.size).toBe(200000);
    expect(result.hash).toBe(expected(buf));
    expect(result.hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('wraps modulo 2^64 instead of overflowing', async () => {
    const buf = Buffer.alloc(131072, 0xff);
    const path = join(dir, 'b.mkv');
    await writeFile(path, buf);
    expect((await opensubtitlesHash(path)).hash).toBe(expected(buf));
  });

  it('does not throw on a file under 64 KiB', async () => {
    const path = join(dir, 'small.mkv');
    await writeFile(path, Buffer.from('hello world 12345'));
    const result = await opensubtitlesHash(path);
    expect(result.size).toBe(17);
    expect(result.hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("opens the file with the read-only 'r' flag", async () => {
    const path = join(dir, 'c.mkv');
    await writeFile(path, Buffer.alloc(1000, 1));
    await opensubtitlesHash(path);
    expect(vi.mocked(fsp.open)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fsp.open).mock.calls[0]).toEqual([path, 'r']);
  });
});
