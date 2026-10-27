// Defends against a silent failure: a library read that reports an empty result for a file it
// could not read (api would then show no languages for the title), a report that echoes a path
// other than the one api returned, or a read that writes into the library.

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  details: vi.fn(),
  completed: vi.fn(),
  metadata: vi.fn(),
}));

vi.mock('../api/library-probe-reports', () => ({
  libraryProbeDetails: (...a: unknown[]) => h.details(...a),
  libraryProbeCompleted: (...a: unknown[]) => h.completed(...a),
}));
vi.mock('../ffmpeg/metadata', () => ({
  getMetadata: (...a: unknown[]) => h.metadata(...a),
}));

import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Job } from 'bullmq';
import { handleLibraryProbe } from './library-probe.job';
import type { LibraryProbeJob } from '../queue/types';
import { KeyedError } from '../i18n/keyed-error';

const asJob = (data: LibraryProbeJob) => ({ data }) as Job<LibraryProbeJob>;
let dir: string;
let filePath: string;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'library-probe-spec-'));
  filePath = join(dir, 'Film (2020).mkv');
  await writeFile(filePath, 'x');
  await writeFile(join(dir, 'Film (2020).Spanish.sdh.srt'), 'x');
  await writeFile(join(dir, 'Film (2020).en.forced.srt'), 'x');
  h.details.mockReset().mockResolvedValue({ filePath });
  h.completed.mockReset().mockResolvedValue(true);
  h.metadata.mockReset().mockResolvedValue({
    metadata: {
      streams: [
        { codec_type: 'video' },
        { codec_type: 'audio', tags: { language: 'jpn' } },
        { codec_type: 'audio', tags: { language: 'und' } },
        { codec_type: 'subtitle', tags: { language: 'fra' }, disposition: {} },
        { codec_type: 'subtitle', tags: { language: 'eng' }, disposition: { forced: 1 } },
      ],
    },
    raw: '',
  });
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

describe('handleLibraryProbe', () => {
  it('reports the echoed path, audio, embedded subtitles and sidecar tags without forced ones', async () => {
    await handleLibraryProbe(asJob({ movieId: 4 }));

    expect(h.details).toHaveBeenCalledWith({ movieId: 4 });
    expect(h.completed).toHaveBeenCalledTimes(1);
    const [target, path, audio, embedded, sidecars] = h.completed.mock.calls[0];
    expect(target).toEqual({ movieId: 4 });
    expect(path).toBe(filePath);
    expect(audio).toEqual(['jpn']);
    expect(embedded).toEqual(['fre']);
    expect(sidecars).toHaveLength(1);
    expect(sidecars[0].toLowerCase()).toContain('spanish');
  });

  it('targets an episode when only episodeId is set', async () => {
    await handleLibraryProbe(asJob({ episodeId: 8 }));
    expect(h.details).toHaveBeenCalledWith({ episodeId: 8 });
    expect(h.completed.mock.calls[0][0]).toEqual({ episodeId: 8 });
  });

  it('ignores a payload with neither or both ids', async () => {
    await handleLibraryProbe(asJob({}));
    await handleLibraryProbe(asJob({ movieId: 1, episodeId: 2 }));
    expect(h.details).not.toHaveBeenCalled();
    expect(h.completed).not.toHaveBeenCalled();
  });

  it.each([
    'error.libraryProbe.invalid_target',
    'error.libraryProbe.not_found',
    'error.libraryProbe.media_server_unavailable',
  ])('reports nothing when details fails with %s', async (key) => {
    h.details.mockRejectedValue(new KeyedError(key, 'x'));
    await handleLibraryProbe(asJob({ movieId: 4 }));
    expect(h.metadata).not.toHaveBeenCalled();
    expect(h.completed).not.toHaveBeenCalled();
  });

  it('rethrows an error that is not keyed', async () => {
    h.details.mockRejectedValue(new Error('boom'));
    await expect(handleLibraryProbe(asJob({ movieId: 4 }))).rejects.toThrow('boom');
    expect(h.completed).not.toHaveBeenCalled();
  });

  it('reports nothing and logs the path when getMetadata throws', async () => {
    h.metadata.mockRejectedValue(new Error('ffprobe died'));
    await handleLibraryProbe(asJob({ movieId: 4 }));
    expect(h.completed).not.toHaveBeenCalled();
    expect(errorSpy.mock.calls.flat().join(' ')).toContain(filePath);
  });

  it('reports nothing when the directory is missing', async () => {
    h.details.mockResolvedValue({ filePath: join(dir, 'gone', 'Film.mkv') });
    await handleLibraryProbe(asJob({ movieId: 4 }));
    expect(h.completed).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('does not treat a stale (false) acknowledgement as an error', async () => {
    h.completed.mockResolvedValue(false);
    await expect(handleLibraryProbe(asJob({ movieId: 4 }))).resolves.toBeUndefined();
  });

  it('leaves the directory listing untouched', async () => {
    const before = (await readdir(dir)).sort();
    await handleLibraryProbe(asJob({ movieId: 4 }));
    expect((await readdir(dir)).sort()).toEqual(before);
  });
});
