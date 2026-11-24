// The audio-variant resolution is the one value that decides which Spanish dub survives: if the
// driver kept passing the empty resolution to the command builder (or to the stream-end rule, which
// counts kept audio tracks) the detection would run, log a verdict and change nothing.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  getMetadata: vi.fn(),
  resolveAudioLanguages: vi.fn(),
  resolveAudioVariants: vi.fn(),
  resolveStreamEndTrim: vi.fn(),
  resolveSubtitlePruning: vi.fn(),
  buildFfmpegCommand: vi.fn(),
  runFfmpeg: vi.fn(),
  resolveFilmGrain: vi.fn(),
}));

vi.mock('../ffmpeg/metadata', () => ({ getMetadata: m.getMetadata }));
vi.mock('./audio-language', () => ({ resolveAudioLanguages: m.resolveAudioLanguages }));
vi.mock('./grain-mode', () => ({ resolveFilmGrain: m.resolveFilmGrain }));
vi.mock('./dub-trim', () => ({ resolveDubTrim: vi.fn().mockResolvedValue(null) }));
vi.mock('./subtitle-prune', () => ({ resolveSubtitlePruning: m.resolveSubtitlePruning }));
vi.mock('./audio-variant', () => ({ resolveAudioVariants: m.resolveAudioVariants }));
vi.mock('./stream-end-trim', () => ({ resolveStreamEndTrim: m.resolveStreamEndTrim }));
vi.mock('../ffmpeg/buildCommand', () => ({ buildFfmpegCommand: m.buildFfmpegCommand }));
vi.mock('../ffmpeg/runner', () => ({ runFfmpeg: m.runFfmpeg }));

import { encodeFfmpeg } from './encode.ffmpeg';

describe('encodeFfmpeg audio variants', () => {
  beforeEach(() => {
    Object.values(m).forEach((fn) => fn.mockReset());
    m.getMetadata.mockResolvedValue({ metadata: { format: { duration: '100' }, streams: [] }, raw: '{}' });
    m.resolveAudioLanguages.mockImplementation(async (_d: any, _i: string, metadata: any) => ({ metadata, undetermined: [] }));
    m.resolveFilmGrain.mockResolvedValue({ filmGrain: false });
    m.resolveStreamEndTrim.mockResolvedValue(null);
    m.resolveSubtitlePruning.mockResolvedValue({ drops: new Set<number>(), variants: new Map<number, string>() });
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

  // Spec 118, REQ-7
  it('passes the subtitle resolver drops and variants to buildFfmpegCommand', async () => {
    const drops = new Set([4]);
    const variants = new Map([[3, 'es-419']]);
    m.resolveAudioVariants.mockResolvedValue({ tags: new Map(), duplicates: new Set<number>() });
    m.resolveSubtitlePruning.mockResolvedValue({ drops, variants });
    const details = { subtitleVariantDetection: true } as any;

    await encodeFfmpeg('/d/a.mkv', '/o/a.mkv', details, async () => {}, async () => {}, new AbortController().signal);

    expect(m.resolveSubtitlePruning.mock.calls[0][0]).toBe(details);
    expect(m.buildFfmpegCommand.mock.calls[0][6]).toBe(drops);
    expect(m.buildFfmpegCommand.mock.calls[0][8]).toBe(variants);
  });

  // Spec 122, REQ-5 REQ-6 REQ-10
  it('hands onProbe the raw probe and every later read the re-labelled metadata', async () => {
    const probed = { format: { duration: '100' }, streams: [{ index: 1, codec_type: 'audio', tags: {} }] };
    const labelled = { format: { duration: '100' }, streams: [{ index: 1, codec_type: 'audio', tags: { language: 'eng' } }] };
    m.getMetadata.mockResolvedValue({ metadata: probed, raw: '{"raw":true}' });
    m.resolveAudioLanguages.mockResolvedValue({ metadata: labelled, undetermined: [] });
    m.resolveAudioVariants.mockResolvedValue({ tags: new Map(), duplicates: new Set<number>() });
    const details = { compressionEnabled: true } as any;
    const signal = new AbortController().signal;
    const onProbe = vi.fn().mockResolvedValue(undefined);

    await encodeFfmpeg('/d/a.mkv', '/o/a.mkv', details, async () => {}, onProbe, signal);

    expect(m.resolveAudioLanguages).toHaveBeenCalledWith(details, '/d/a.mkv', probed, signal);
    expect(onProbe).toHaveBeenCalledWith('/d/a.mkv', '{"raw":true}');
    expect(m.resolveAudioVariants.mock.calls[0][2]).toBe(labelled);
    expect(m.resolveStreamEndTrim.mock.calls[0][2]).toBe(labelled);
    expect(m.resolveSubtitlePruning.mock.calls[0][2]).toBe(labelled);
    expect(m.buildFfmpegCommand.mock.calls[0][2]).toBe(labelled);
  });

  // Spec 123, REQ-4 REQ-5 REQ-6
  describe('global provenance tags', () => {
    const details = {
      sourceTag: 'Movie.2020/movie.mkv',
      contentKind: 'LIVE_ACTION',
      compressionResolution: '1080p',
    } as any;
    const h264 = { codec_type: 'video', codec_name: 'h264', width: 3840, height: 2160, field_order: 'tt' };

    type Produced = { global: string | null; video: string | null };
    async function produced(): Promise<{ global: string; video: string }> {
      await encodeFfmpeg('/d/a.mkv', '/o/a.mkv', details, async () => {}, async () => {}, new AbortController().signal);
      const producer = m.runFfmpeg.mock.calls[0][7] as () => Promise<Produced>;
      return (await producer()) as { global: string; video: string };
    }
    const names = (xml: string) => [...xml.matchAll(/<Name>([^<]+)<\/Name>/g)].map((x) => x[1]);

    beforeEach(() => {
      m.resolveAudioVariants.mockResolvedValue({ tags: new Map(), duplicates: new Set<number>() });
    });

    it('writes exactly SOURCE, VERSION and ENCODED_AT globally and the REQ-5 children on the video group', async () => {
      m.getMetadata
        .mockResolvedValueOnce({ metadata: { format: { duration: '100' }, streams: [h264] }, raw: '{}' })
        .mockResolvedValueOnce({ metadata: { streams: [{ codec_type: 'video', width: 1920, height: 1080 }] }, raw: '{}' });
      m.resolveFilmGrain.mockResolvedValue({ filmGrain: true, decidedBy: 'gate' });
      m.resolveStreamEndTrim.mockResolvedValue(42.5);

      const { global, video } = await produced();

      expect(names(global)).toEqual(['PERCEPTOR', 'SOURCE', 'VERSION', 'ENCODED_AT']);
      expect(video).toContain('<Targets/>');
      for (const name of ['CRF', 'PRESET', 'CONTENT_KIND', 'RESOLUTION_CEILING', 'SOURCE_RESOLUTION',
        'DEINTERLACED', 'GRAIN_APPLIED', 'GRAIN_DECIDED_BY', 'STREAM_END_TRIM']) {
        expect(names(video)).toContain(name);
      }
      expect(video).toContain('3840x2160');
      expect(video).not.toContain('1920x1080');
      expect(video).toContain('<String>gate</String>');
      expect(names(video)).not.toContain('DUB_TRIM');
      expect(names(video)).not.toContain('GRAIN');
      expect(m.getMetadata.mock.calls[1][0]).toContain('.working.mkv');
    });

    it('omits CRF, PRESET, GRAIN and DEINTERLACED for a stream copy', async () => {
      const av1 = { codec_type: 'video', codec_name: 'av1', width: 1280, height: 720, field_order: 'tt' };
      m.getMetadata
        .mockResolvedValueOnce({ metadata: { format: { duration: '100' }, streams: [av1] }, raw: '{}' })
        .mockResolvedValueOnce({ metadata: { streams: [av1] }, raw: '{}' });
      m.resolveFilmGrain.mockResolvedValue({ filmGrain: true, decidedBy: 'title' });

      const { video: xml } = await produced();

      expect(xml).toContain('<Name>CONTENT_KIND</Name>');
      for (const name of ['CRF', 'PRESET', 'GRAIN_APPLIED', 'GRAIN_DECIDED_BY', 'DEINTERLACED']) {
        expect(xml).not.toContain(`<Name>${name}</Name>`);
      }
    });

    it('still writes the video group when the working-file probe throws', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      m.getMetadata
        .mockResolvedValueOnce({ metadata: { format: { duration: '100' }, streams: [h264] }, raw: '{}' })
        .mockRejectedValueOnce(new Error('probe failed'));

      const { global, video } = await produced();

      for (const name of ['CRF', 'SOURCE_RESOLUTION']) {
        expect(video).toContain(`<Name>${name}</Name>`);
      }
      expect(names(global)).toEqual(['PERCEPTOR', 'SOURCE', 'VERSION', 'ENCODED_AT']);
      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });
  });
});
