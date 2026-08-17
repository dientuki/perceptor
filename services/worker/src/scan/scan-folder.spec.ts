// Defends REQ-3/REQ-4/AC-10: the scan's "main video" pick must be the
// largest file carrying a known video extension, never a guess from the
// filename. A wrong pick here is silent — the job still reports success,
// but the ProcessJob it creates points at a sample or a .nfo/.srt instead
// of the film, and nothing downstream notices. Also covers the no-video
// folder (which must surface as an error upstream, not an empty success)
// and the single-file downloadPath case (LOCAL_FILE sources).

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

  it('picks the largest video file regardless of its name', async () => {
    // A small file named to look like the real release, a bigger one named
    // like a sample — the size rule must win over the name.
    await writeFile(join(root, 'Movie.Title.2024.1080p.mkv'), Buffer.alloc(100));
    await writeFile(join(root, 'sample.mkv'), Buffer.alloc(10_000));

    const result = await scanFolder(root);

    expect(result.matchedFilePath).toBe(join(root, 'sample.mkv'));
    expect(result.files).toHaveLength(2);
  });

  it('does not let a larger non-video file win over a smaller video file', async () => {
    await writeFile(join(root, 'Movie.Title.2024.1080p.mkv'), Buffer.alloc(1_000));
    await writeFile(join(root, 'Movie.Title.2024.1080p.nfo'), Buffer.alloc(1_000_000));

    const result = await scanFolder(root);

    expect(result.matchedFilePath).toBe(join(root, 'Movie.Title.2024.1080p.mkv'));
    expect(result.files).toHaveLength(2);
  });

  it('yields a null matchedFilePath for a folder with no video file', async () => {
    await writeFile(join(root, 'readme.txt'), Buffer.alloc(10));
    await mkdir(join(root, 'subs'));
    await writeFile(join(root, 'subs', 'movie.srt'), Buffer.alloc(20));

    const result = await scanFolder(root);

    expect(result.matchedFilePath).toBeNull();
    expect(result.files).toHaveLength(2);
  });

  it('inventories a single-file downloadPath as one entry', async () => {
    const filePath = join(root, 'Movie.Title.2024.1080p.mkv');
    await writeFile(filePath, Buffer.alloc(500));

    const result = await scanFolder(filePath);

    expect(result.files).toEqual([
      { filePath, fileName: 'Movie.Title.2024.1080p.mkv', size: 500 },
    ]);
    expect(result.matchedFilePath).toBe(filePath);
  });
});
