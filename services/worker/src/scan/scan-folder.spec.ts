// Defends REQ-2/AC-10: scanFolder must enumerate every file in the download
// with its size and isVideo flag, and must never itself pick a "main" file —
// that selection now lives in select-matches.ts. A wrong isVideo flag here is
// silent: it either drops a real episode from the season pipeline's candidate
// list or lets a sidecar (.nfo/.srt) get treated as a video downstream. Also
// covers the single-file downloadPath case (LOCAL_FILE sources).

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanFolder } from './scan-folder';

describe('scanFolder', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'perceptor-scan-'));
  });

  afterEach(async () => {
    const { rm } = await import('node:fs/promises');
    await rm(root, { recursive: true, force: true });
  });

  it('marks a .mkv file as video and a .nfo file as not video', async () => {
    await writeFile(join(root, 'Movie.Title.2024.1080p.mkv'), Buffer.alloc(100));
    await writeFile(join(root, 'Movie.Title.2024.1080p.nfo'), Buffer.alloc(10));

    const result = await scanFolder(root);

    expect(result.files).toHaveLength(2);
    expect(result.files.find((f) => f.fileName.endsWith('.mkv'))?.isVideo).toBe(true);
    expect(result.files.find((f) => f.fileName.endsWith('.nfo'))?.isVideo).toBe(false);
  });

  it('inventories every file in a folder with no video, none flagged as video', async () => {
    await writeFile(join(root, 'readme.txt'), Buffer.alloc(10));
    await mkdir(join(root, 'subs'));
    await writeFile(join(root, 'subs', 'movie.srt'), Buffer.alloc(20));

    const result = await scanFolder(root);

    expect(result.files).toHaveLength(2);
    expect(result.files.every((f) => f.isVideo === false)).toBe(true);
  });

  it('inventories a single-file downloadPath as one entry', async () => {
    const filePath = join(root, 'Movie.Title.2024.1080p.mkv');
    await writeFile(filePath, Buffer.alloc(500));

    const result = await scanFolder(filePath);

    expect(result.files).toEqual([
      { filePath, fileName: 'Movie.Title.2024.1080p.mkv', size: 500, isVideo: true },
    ]);
  });
});
