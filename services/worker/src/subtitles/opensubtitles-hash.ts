import { open } from 'node:fs/promises';

const CHUNK = 65536;

// https://trac.opensubtitles.org/projects/opensubtitles/wiki/HashSourceCodes
export async function opensubtitlesHash(
  filePath: string,
): Promise<{ size: number; hash: string }> {
  const handle = await open(filePath, 'r');
  try {
    const { size } = await handle.stat();
    const length = Math.min(CHUNK, size);
    const head = Buffer.alloc(length);
    const tail = Buffer.alloc(length);
    await handle.read(head, 0, length, 0);
    await handle.read(tail, 0, length, Math.max(0, size - length));

    const mask = (1n << 64n) - 1n;
    let sum = BigInt(size) & mask;
    for (const chunk of [head, tail]) {
      const words = Math.floor(chunk.length / 8);
      for (let i = 0; i < words; i++) {
        sum = (sum + chunk.readBigUInt64LE(i * 8)) & mask;
      }
    }
    return { size, hash: sum.toString(16).padStart(16, '0') };
  } finally {
    await handle.close();
  }
}
