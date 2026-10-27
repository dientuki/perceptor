// Defends against a silent failure: a probe that reports for a search api no longer owns, a
// failed ffprobe/hash reported as an empty successful probe (api would then search for every
// language), or a probe that never reports and leaves the search WAITING.

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  details: vi.fn(),
  started: vi.fn(),
  completed: vi.fn(),
  failed: vi.fn(),
  metadata: vi.fn(),
}));

vi.mock('../api/subtitle-probe-reports', () => ({
  subtitleProbeDetails: (...a: unknown[]) => h.details(...a),
  subtitleProbeStarted: (...a: unknown[]) => h.started(...a),
  subtitleProbeCompleted: (...a: unknown[]) => h.completed(...a),
  subtitleProbeFailed: (...a: unknown[]) => h.failed(...a),
}));
vi.mock('../ffmpeg/metadata', () => ({
  getMetadata: (...a: unknown[]) => h.metadata(...a),
}));

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Job } from 'bullmq';
import { handleSubtitleProbe } from './subtitle-probe.job';
import type { SubtitleProbeJob } from '../queue/types';
import { KeyedError } from '../i18n/keyed-error';

const job = { data: { subtitleSearchId: 9 } } as Job<SubtitleProbeJob>;
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'probe-job-spec-'));
  await writeFile(join(dir, 'Film (2020).mkv'), Buffer.alloc(1000, 1));
  await writeFile(join(dir, 'Film (2020).Spanish.sdh.srt'), 'x');
  await writeFile(join(dir, 'Film (2020).en.forced.srt'), 'x');
  h.details.mockReset().mockResolvedValue({ id: 9, filePath: join(dir, 'Film (2020).mkv') });
  h.started.mockReset().mockResolvedValue(true);
  h.completed.mockReset().mockResolvedValue(true);
  h.failed.mockReset().mockResolvedValue(true);
  h.metadata.mockReset().mockResolvedValue({
    metadata: {
      streams: [
        { codec_type: 'video' },
        { codec_type: 'subtitle', tags: { language: 'fra' }, disposition: {} },
        { codec_type: 'subtitle', tags: { language: 'eng' }, disposition: { forced: 1 } },
      ],
    },
    raw: '',
  });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

describe('handleSubtitleProbe', () => {
  it('reports embedded languages, raw sidecar tags, size and hash', async () => {
    await handleSubtitleProbe(job);

    expect(h.completed).toHaveBeenCalledTimes(1);
    const [id, embedded, sidecars, size, hash] = h.completed.mock.calls[0];
    expect(id).toBe(9);
    expect(embedded).toEqual(['fre']);
    expect(sidecars).toEqual(['Spanish']);
    expect(size).toBe(1000);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(h.failed).not.toHaveBeenCalled();
  });

  it('reports nothing when the search no longer exists', async () => {
    h.details.mockRejectedValue(
      new KeyedError('error.subtitleSearch.probe_not_found', 'gone'),
    );
    await handleSubtitleProbe(job);

    expect(h.started).not.toHaveBeenCalled();
    expect(h.completed).not.toHaveBeenCalled();
    expect(h.failed).not.toHaveBeenCalled();
  });

  it('rethrows any other details error', async () => {
    h.details.mockRejectedValue(new KeyedError('error.auth.forbidden', 'nope'));
    await expect(handleSubtitleProbe(job)).rejects.toThrow('nope');
  });

  it('reports nothing when started is false', async () => {
    h.started.mockResolvedValue(false);
    await handleSubtitleProbe(job);

    expect(h.metadata).not.toHaveBeenCalled();
    expect(h.completed).not.toHaveBeenCalled();
    expect(h.failed).not.toHaveBeenCalled();
  });

  it('reports probe_failed when ffprobe throws', async () => {
    h.metadata.mockRejectedValue(new Error('ffprobe died'));
    await handleSubtitleProbe(job);

    expect(h.completed).not.toHaveBeenCalled();
    expect(h.failed).toHaveBeenCalledWith(9, 'error.subtitleSearch.probe_failed');
  });

  it('reports probe_failed when the file cannot be hashed', async () => {
    h.details.mockResolvedValue({ id: 9, filePath: join(dir, 'Missing.mkv') });
    await handleSubtitleProbe(job);

    expect(h.completed).not.toHaveBeenCalled();
    expect(h.failed).toHaveBeenCalledWith(9, 'error.subtitleSearch.probe_failed');
  });
});
