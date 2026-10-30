// The audio-variant resolution is the one value that decides which Spanish dub survives: if the
// driver kept passing the empty resolution to the command builder (or to the stream-end rule, which
// counts kept audio tracks) the detection would run, log a verdict and change nothing.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  getMetadata: vi.fn(),
  resolveAudioVariants: vi.fn(),
  resolveStreamEndTrim: vi.fn(),
  buildFfmpegCommand: vi.fn(),
  runFfmpeg: vi.fn(),
}));

vi.mock('../ffmpeg/metadata', () => ({ getMetadata: m.getMetadata }));
vi.mock('./grain-mode', () => ({ resolveFilmGrain: vi.fn().mockResolvedValue(false) }));
vi.mock('./dub-trim', () => ({ resolveDubTrim: vi.fn().mockResolvedValue(null) }));
vi.mock('./subtitle-prune', () => ({ resolveSubtitlePruning: vi.fn().mockResolvedValue(new Set()) }));
vi.mock('./audio-variant', () => ({ resolveAudioVariants: m.resolveAudioVariants }));
vi.mock('./stream-end-trim', () => ({ resolveStreamEndTrim: m.resolveStreamEndTrim }));
vi.mock('../ffmpeg/buildCommand', () => ({ buildFfmpegCommand: m.buildFfmpegCommand }));
vi.mock('../ffmpeg/runner', () => ({ runFfmpeg: m.runFfmpeg }));

import { encodeFfmpeg } from './encode.ffmpeg';

describe('encodeFfmpeg audio variants', () => {
  beforeEach(() => {
    Object.values(m).forEach((fn) => fn.mockReset());
    m.getMetadata.mockResolvedValue({ metadata: { format: { duration: '100' }, streams: [] }, raw: '{}' });
    m.resolveStreamEndTrim.mockResolvedValue(null);
    m.buildFfmpegCommand.mockReturnValue(['-i', 'x']);
    m.runFfmpeg.mockResolvedValue('ffmpeg -i x');
  });

  it('passes the resolver map to buildFfmpegCommand and to the stream-end rule', async () => {
    const resolution = { tags: new Map([[2, 'es-ES']]), duplicates: new Set<number>() };
    m.resolveAudioVariants.mockResolvedValue(resolution);
    const details = { audioVariantDetection: true } as any;
    const signal = new AbortController().signal;

    await encodeFfmpeg('/d/a.mkv', '/o/a.mkv', details, async () => {}, async () => {}, signal);

    expect(m.resolveAudioVariants).toHaveBeenCalledWith(details, '/d/a.mkv', expect.anything(), signal);
    expect(m.buildFfmpegCommand.mock.calls[0][7]).toBe(resolution);
    expect(m.resolveStreamEndTrim.mock.calls[0][4]).toBe(resolution);
  });
});
