import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, chmod, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// rename() can't be spied directly on the real ESM module (Node freezes it,
// so vi.spyOn throws "Cannot redefine property"). vi.mock with
// importOriginal gives passthrough.ts a rename it actually imports, wired to
// a hoisted, per-test-controllable stub — every other node:fs/promises call
// still goes to the real implementation.
const { forceNextRenameExdev, renameCallCount } = vi.hoisted(() => ({
  forceNextRenameExdev: { value: false },
  renameCallCount: { value: 0 },
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rename: async (...args: Parameters<typeof actual.rename>) => {
      renameCallCount.value++;
      if (forceNextRenameExdev.value) {
        forceNextRenameExdev.value = false;
        const err = new Error('cross-device link') as NodeJS.ErrnoException;
        err.code = 'EXDEV';
        throw err;
      }
      return actual.rename(...args);
    },
  };
});

import { passthrough } from './passthrough';
import { KeyedError } from '../i18n/keyed-error';
import { ERROR_ENCODE_MOVE_FAILED } from '../i18n/error-keys';

// This is the "compression off" path (032-optional-compression): it moves the
// real source file instead of running ffmpeg. A bug here either loses a
// multi-GB file for good, or leaves a half-written file sitting under its
// final name where the media server (and the user) would treat it as
// complete — both are silent failures nothing downstream ever reports. Runs
// against a real mkdtemp with real files, the same reasoning
// media-roots.service.spec.ts gives for skipping mocks on this class of bug.

const noopProbe = async () => {};

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'passthrough-spec-'));
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe('passthrough', () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await makeTempDir();
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it('moves the file to the destination with the right bytes and removes the source', async () => {
    const input = join(baseDir, 'source.mp4');
    const outputDir = join(baseDir, 'library', 'Some Film (2019) [tmdbid=1]');
    const output = join(outputDir, 'Some Film (2019).mp4');
    const content = Buffer.from('fake video bytes '.repeat(1000));
    await writeFile(input, content);

    const progressCalls: number[] = [];
    const result = await passthrough(
      input,
      output,
      {} as never,
      async (progress) => {
        progressCalls.push(progress);
      },
      noopProbe,
    );

    expect(result).toEqual({ ffmpegCommand: '' });
    expect(await readFile(output)).toEqual(content);
    expect(await fileExists(input)).toBe(false);
    expect(progressCalls).toEqual([100]);
  });

  it('creates the destination folder if it does not exist', async () => {
    const input = join(baseDir, 'source.mkv');
    const output = join(baseDir, 'nested', 'deeper', 'dest.mkv');
    await writeFile(input, 'content');

    await passthrough(input, output, {} as never, async () => {}, noopProbe);

    expect(await fileExists(output)).toBe(true);
  });

  it('leaves the placed file at mode 0664 even when the source is 0644', async () => {
    const input = join(baseDir, 'source.mkv');
    const output = join(baseDir, 'dest.mkv');
    await writeFile(input, 'content');
    await chmod(input, 0o644);

    await passthrough(input, output, {} as never, async () => {}, noopProbe);

    const mode = (await stat(output)).mode & 0o777;
    expect(mode).toBe(0o664);
  });

  it('calls onProgress(100) only once the file is at its final name', async () => {
    const input = join(baseDir, 'source.mkv');
    const output = join(baseDir, 'dest.mkv');
    await writeFile(input, 'content');

    let sawFinalNameBeforeProgress = false;
    await passthrough(
      input,
      output,
      {} as never,
      async () => {
        sawFinalNameBeforeProgress = await fileExists(output);
      },
      noopProbe,
    );

    expect(sawFinalNameBeforeProgress).toBe(true);
  });

  it('throws error.encode.move_failed on an unwritable destination, leaves the source in place, and leaves no final-named file or .part sibling behind', async () => {
    const input = join(baseDir, 'source.mkv');
    await writeFile(input, 'content');

    const readonlyDir = join(baseDir, 'readonly-dest');
    await mkdir(readonlyDir, { recursive: true });
    const output = join(readonlyDir, 'dest.mkv');
    // No write permission in the destination folder: neither rename() nor
    // copyFile() can create an entry there.
    await chmod(readonlyDir, 0o500);

    try {
      await expect(
        passthrough(input, output, {} as never, async () => {}, noopProbe),
      ).rejects.toMatchObject({
        constructor: KeyedError,
        key: ERROR_ENCODE_MOVE_FAILED,
      });

      expect(await fileExists(input)).toBe(true);
      expect(await fileExists(output)).toBe(false);
    } finally {
      // Restore so afterEach's rm(recursive) can clean up.
      await chmod(readonlyDir, 0o700);
    }
  });

  it('takes the copy path on EXDEV, cleans up its .part on failure, and only unlinks the source after the destination rename succeeds', async () => {
    const input = join(baseDir, 'source.mkv');
    const output = join(baseDir, 'dest.mkv');
    const content = 'cross device content';
    await writeFile(input, content);

    // node:fs/promises has no way to force a real EXDEV in one tmpdir, so the
    // module-level mock above rejects the *next* rename() call with EXDEV —
    // the direct move attempt — and delegates every other call, including
    // the .part -> output rename the copy fallback performs, to the real
    // implementation.
    renameCallCount.value = 0;
    forceNextRenameExdev.value = true;

    const result = await passthrough(input, output, {} as never, async () => {}, noopProbe);

    expect(result).toEqual({ ffmpegCommand: '' });
    expect(renameCallCount.value).toBe(2);
    expect(await readFile(output, 'utf8')).toBe(content);
    expect(await fileExists(input)).toBe(false);
    expect(await fileExists(join(baseDir, 'dest.part.mkv'))).toBe(false);
  });
});
