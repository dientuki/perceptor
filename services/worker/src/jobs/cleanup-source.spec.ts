// Defends REQ-10/REQ-11/REQ-12: cleanup-source.ts is the one place in this
// service that is allowed to swallow errors, and the one place a wrong
// branch produces a job marked completed with nothing to show for it in any
// log. Three ways this used to fail (services/worker/src/jobs/encode.job.ts
// before this feature): the cleanup ran only when `infoHash` was set, so a
// LOCAL_FILE (a tus upload) was never cleaned up at all; it ran inside the
// encode's try, so a cleanup failure demoted an already-completed job to
// ERROR; and it deleted `downloadPath` straight off the database with no
// check that it was even inside the downloads root.

import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `actualRm` holds the true, unmocked node:fs/promises.rm, captured once
// inside the vi.mock() factory below via importOriginal() — it cannot be
// obtained by importing 'node:fs/promises' normally anywhere in this file,
// because vi.mock() intercepts every import of that specifier, including
// this file's own `import { rm } from 'node:fs/promises'` above. Routing
// mockRm's default implementation through the mocked `rm` instead of
// `actualRm` would recurse into itself forever.
const { fetchGraphQLMock, mockRm, actualRm } = vi.hoisted(() => ({
  fetchGraphQLMock: vi.fn(),
  mockRm: vi.fn(),
  actualRm: { current: undefined as unknown as (...args: any[]) => Promise<void> },
}));

vi.mock('../api/graphql-client', () => ({
  fetchGraphQL: (...args: unknown[]) => fetchGraphQLMock(...args),
}));

// `rm` is wrapped in a spy (defaulting to the real implementation) so the
// "throwing rm" case below can override it for a single call without trying
// to vi.spyOn() a read-only ESM binding, which node:fs/promises is.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  actualRm.current = actual.rm;
  return { ...actual, rm: (...args: unknown[]) => mockRm(...args) };
});

import { cleanupSource } from './cleanup-source';

let root: string;

beforeEach(async () => {
  fetchGraphQLMock.mockReset();
  fetchGraphQLMock.mockResolvedValue(undefined);
  // Re-armed on every test rather than relying on vi.restoreAllMocks():
  // mockRm has no "original" implementation of its own (it's a plain
  // vi.fn(), not a spy on an existing function) — restoring it resets it to
  // a no-op that resolves undefined without deleting anything, which made
  // every test after the first look like it passed while silently leaving
  // every file in place.
  mockRm.mockReset();
  mockRm.mockImplementation((...args: unknown[]) => actualRm.current(...args));
  root = await mkdtemp(join(tmpdir(), 'cleanup-source-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('cleanupSource — LOCAL_FILE', () => {
  it('deletes the file and rmdirs its now-empty staging directory', async () => {
    const stagingDir = join(root, 'imports', 'upload-1');
    const filePath = join(stagingDir, 'movie.mkv');
    await mkdir(stagingDir, { recursive: true });
    await writeFile(filePath, 'x');

    await cleanupSource({
      mediaSourceId: 1,
      sourceKind: 'LOCAL_FILE',
      infoHash: null,
      downloadPath: filePath,
      downloadsRoot: root,
    });

    await expect(readFile(filePath)).rejects.toThrow();
    await expect(readdir(stagingDir)).rejects.toThrow();
  });

  // The bug this feature fixes: the old code branched the whole cleanup
  // block on `if (details.infoHash)`, so a LOCAL_FILE — always null
  // infoHash — never ran any cleanup at all. This assertion (a LOCAL_FILE
  // with infoHash: null still gets deleted) is exactly what fails if
  // cleanup-source.ts's LOCAL_FILE branch is gated on infoHash instead of
  // sourceKind — see the worker report for the failing-output proof, taken
  // by switching the source and reverting it, rather than duplicated here as
  // a second copy of this same test.
  it('deletes a LOCAL_FILE even though its infoHash is null', async () => {
    const stagingDir = join(root, 'imports', 'upload-2');
    const filePath = join(stagingDir, 'movie.mkv');
    await mkdir(stagingDir, { recursive: true });
    await writeFile(filePath, 'x');

    await cleanupSource({
      mediaSourceId: 2,
      sourceKind: 'LOCAL_FILE',
      infoHash: null,
      downloadPath: filePath,
      downloadsRoot: root,
    });
    await expect(readFile(filePath)).rejects.toThrow();
  });

  it('deletes the file but keeps a staging directory that is not empty', async () => {
    const stagingDir = join(root, 'imports', 'upload-3');
    const filePath = join(stagingDir, 'movie.mkv');
    const siblingPath = join(stagingDir, 'sample.mkv');
    await mkdir(stagingDir, { recursive: true });
    await writeFile(filePath, 'x');
    await writeFile(siblingPath, 'y');

    await expect(
      cleanupSource({
        mediaSourceId: 3,
        sourceKind: 'LOCAL_FILE',
        infoHash: null,
        downloadPath: filePath,
        downloadsRoot: root,
      }),
    ).resolves.toBeUndefined();

    await expect(readFile(filePath)).rejects.toThrow();
    expect(await readdir(stagingDir)).toEqual(['sample.mkv']);
  });

  it('never calls downloadRemove for a LOCAL_FILE source', async () => {
    const stagingDir = join(root, 'imports', 'upload-4');
    const filePath = join(stagingDir, 'movie.mkv');
    await mkdir(stagingDir, { recursive: true });
    await writeFile(filePath, 'x');

    await cleanupSource({
      mediaSourceId: 4,
      sourceKind: 'LOCAL_FILE',
      infoHash: null,
      downloadPath: filePath,
      downloadsRoot: root,
    });

    expect(fetchGraphQLMock).not.toHaveBeenCalled();
  });
});

describe('cleanupSource — LOCAL_FOLDER', () => {
  it('never calls downloadRemove and deletes the folder recursively', async () => {
    const folderPath = join(root, 'imports', 'upload-folder');
    await mkdir(folderPath, { recursive: true });
    await writeFile(join(folderPath, 'movie.mkv'), 'x');
    await writeFile(join(folderPath, 'extra.txt'), 'y');

    await cleanupSource({
      mediaSourceId: 5,
      sourceKind: 'LOCAL_FOLDER',
      infoHash: null,
      downloadPath: folderPath,
      downloadsRoot: root,
    });

    expect(fetchGraphQLMock).not.toHaveBeenCalled();
    await expect(readdir(folderPath)).rejects.toThrow();
  });
});

describe('cleanupSource — TORRENT_SEARCH / TORRENT_FILE', () => {
  it('calls downloadRemove then deletes the download directory recursively', async () => {
    const downloadPath = join(root, 'abcd1234');
    await mkdir(downloadPath, { recursive: true });
    await writeFile(join(downloadPath, 'movie.mkv'), 'x');

    await cleanupSource({
      mediaSourceId: 6,
      sourceKind: 'TORRENT_SEARCH',
      infoHash: 'abcd1234',
      downloadPath,
      downloadsRoot: root,
    });

    expect(fetchGraphQLMock).toHaveBeenCalledTimes(1);
    expect(fetchGraphQLMock).toHaveBeenCalledWith(
      expect.stringContaining('downloadRemove'),
      { id: 6 },
    );
    await expect(readdir(downloadPath)).rejects.toThrow();
  });

  it('calls downloadRemove for TORRENT_FILE too and deletes recursively', async () => {
    const downloadPath = join(root, 'efgh5678');
    await mkdir(downloadPath, { recursive: true });
    await writeFile(join(downloadPath, 'movie.mkv'), 'x');

    await cleanupSource({
      mediaSourceId: 7,
      sourceKind: 'TORRENT_FILE',
      infoHash: 'efgh5678',
      downloadPath,
      downloadsRoot: root,
    });

    expect(fetchGraphQLMock).toHaveBeenCalledTimes(1);
    await expect(readdir(downloadPath)).rejects.toThrow();
  });
});

describe('cleanupSource — containment (REQ-12)', () => {
  it('deletes nothing when downloadPath is outside downloadsRoot', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'cleanup-outside-'));
    const filePath = join(outside, 'movie.mkv');
    await writeFile(filePath, 'x');

    try {
      await cleanupSource({
        mediaSourceId: 8,
        sourceKind: 'TORRENT_SEARCH',
        infoHash: 'ijkl9012',
        downloadPath: filePath,
        downloadsRoot: root,
      });

      // The torrent-client call still happens (guarded on infoHash, not
      // containment); only the filesystem deletion is refused.
      expect(fetchGraphQLMock).toHaveBeenCalledTimes(1);
      await expect(readFile(filePath, 'utf8')).resolves.toBe('x');
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('deletes nothing when downloadsRoot is empty or undefined', async () => {
    const filePath = join(root, 'movie.mkv');
    await writeFile(filePath, 'x');

    await cleanupSource({
      mediaSourceId: 9,
      sourceKind: 'LOCAL_FOLDER',
      infoHash: null,
      downloadPath: filePath,
      downloadsRoot: '' as unknown as string,
    });
    await expect(readFile(filePath, 'utf8')).resolves.toBe('x');

    await cleanupSource({
      mediaSourceId: 9,
      sourceKind: 'LOCAL_FOLDER',
      infoHash: null,
      downloadPath: filePath,
      downloadsRoot: undefined as unknown as string,
    });
    await expect(readFile(filePath, 'utf8')).resolves.toBe('x');
  });
});

describe('cleanupSource — error isolation (REQ-11)', () => {
  it('does not propagate a throwing fetchGraphQL (downloadRemove)', async () => {
    const downloadPath = join(root, 'mnop3456');
    await mkdir(downloadPath, { recursive: true });
    await writeFile(join(downloadPath, 'movie.mkv'), 'x');

    fetchGraphQLMock.mockRejectedValue(new Error('api unreachable'));

    await expect(
      cleanupSource({
        mediaSourceId: 10,
        sourceKind: 'TORRENT_SEARCH',
        infoHash: 'mnop3456',
        downloadPath,
        downloadsRoot: root,
      }),
    ).resolves.toBeUndefined();

    // A downloadRemove failure isolates only that call — the filesystem
    // cleanup still runs, since the torrent client being unreachable says
    // nothing about whether the local files can still be removed.
    await expect(readdir(downloadPath)).rejects.toThrow();
  });

  it('does not propagate a throwing rm', async () => {
    const downloadPath = join(root, 'qrst7890');
    await mkdir(downloadPath, { recursive: true });
    await writeFile(join(downloadPath, 'movie.mkv'), 'x');

    mockRm.mockRejectedValueOnce(new Error('EACCES: permission denied'));

    await expect(
      cleanupSource({
        mediaSourceId: 11,
        sourceKind: 'TORRENT_SEARCH',
        infoHash: 'qrst7890',
        downloadPath,
        downloadsRoot: root,
      }),
    ).resolves.toBeUndefined();
  });
});
