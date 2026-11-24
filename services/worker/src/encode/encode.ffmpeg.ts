import { dirname, join, basename, extname } from 'node:path';
import type { EncodeFn } from './types';
import { getMetadata } from '../ffmpeg/metadata';
import { resolveAudioLanguages } from './audio-language';
import { resolveFilmGrain } from './grain-mode';
import { resolveDubTrim } from './dub-trim';
import { resolveAudioVariants } from './audio-variant';
import { resolveStreamEndTrim } from './stream-end-trim';
import { resolveSubtitlePruning } from './subtitle-prune';
import { buildFfmpegCommand } from '../ffmpeg/buildCommand';
import { runFfmpeg } from '../ffmpeg/runner';
import { videoEncodeFacts } from '../ffmpeg/params';
import { isRemux } from '../ffmpeg/remux-detection';
import { normalizeContentKind } from './content-kind';
import { normalizeCompressionResolution } from './compression-resolution';
import { buildGlobalTagsXml, buildVideoTagsXml, type GlobalTagFacts, type VideoTagFacts } from '../tags/perceptor-tags';
import { perceptorVersion } from '../version';

function toWorkingPath(input: string): string {
  const name = basename(input, extname(input));
  return join(dirname(input), `${name}.working.mkv`);
}

function toPartPath(output: string): string {
  return output.replace(/(\.[^./]+)$/, '.part$1');
}

function resolutionOf(stream: any): string | null {
  const width = Number(stream?.width);
  const height = Number(stream?.height);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? `${width}x${height}` : null;
}

// Spec 123, NFR-3
function optionalFact<T>(name: string, read: () => T): T | null {
  try {
    return read();
  } catch (err) {
    console.warn(`[encode] tag fact ${name} omitted:`, err instanceof Error ? err.message : err);
    return null;
  }
}

export const encodeFfmpeg: EncodeFn = async (input, output, details, onProgress, onProbe, signal) => {
  const workingPath = toWorkingPath(input);
  const partPath = toPartPath(output);

  const { metadata: probed, raw } = await getMetadata(input);

  // Spec 023, REQ-1
  await onProbe(input, raw);
  // Spec 122, REQ-5 REQ-6 REQ-10
  const { metadata } = await resolveAudioLanguages(details, input, probed, signal);

  const sampleSeconds = process.env.ENCODE_SAMPLE_SECONDS;
  const sourceDuration = Number(metadata.format?.duration ?? 0);
  const sample = sampleSeconds ? Number(sampleSeconds) : NaN;

  // Spec 092, REQ-9; Spec 094, REQ-3 NFR-1
  const { filmGrain, decidedBy: grainDecidedBy } = await resolveFilmGrain(details, input, metadata, signal);
  // Spec 098, REQ-3; Spec 099, REQ-10
  const dubCut = await resolveDubTrim(details, input, metadata, signal);
  // Spec 110, REQ-5 REQ-10
  const audioVariants = await resolveAudioVariants(details, input, metadata, signal);
  const endCut = await resolveStreamEndTrim(details, input, metadata, signal, audioVariants);
  // Spec 102, REQ-1
  const { drops: prunedSubtitles, variants: subtitleVariants } = await resolveSubtitlePruning(details, input, metadata, signal);
  const cuts = [dubCut, endCut].filter((c): c is number => c !== null);
  const trimAt = cuts.length > 0 ? Math.min(...cuts) : null;
  const args = buildFfmpegCommand(input, workingPath, metadata, details, filmGrain, trimAt, prunedSubtitles, audioVariants, subtitleVariants);
  // Spec 098, REQ-10
  const candidates = [sourceDuration];
  if (Number.isFinite(sample) && sample > 0) candidates.push(sample);
  if (trimAt !== null) candidates.push(trimAt);
  const valid = candidates.filter((n) => Number.isFinite(n) && n > 0);
  const durationSeconds = valid.length > 0 ? Math.min(...valid) : 0;
  // Spec 123, REQ-4 REQ-5 REQ-6
  const tags = async (): Promise<{ global: string | null; video: string | null }> => {
    const videoStream = (metadata.streams as any[]).find((s) => s.codec_type === 'video');
    const global: GlobalTagFacts = {
      source: details.sourceTag,
      version: optionalFact('VERSION', perceptorVersion),
      encodedAt: new Date(),
    };
    const video: VideoTagFacts = {
      dubTrimSeconds: dubCut,
      streamEndTrimSeconds: endCut,
    };
    const encode = optionalFact('ENCODE', () => {
      const contentKind = normalizeContentKind(details.contentKind);
      const ceiling = normalizeCompressionResolution(details.compressionResolution);
      const quality = isRemux(metadata, input) ? 'remux' : 'web';
      const facts = videoEncodeFacts(videoStream, contentKind, ceiling, quality);
      const parity = ['tt', 'bt', 'bb', 'tb'].includes(videoStream?.field_order);
      return {
        videoCodec: facts.videoCodec,
        crf: facts.crf,
        preset: facts.preset,
        contentKind: details.contentKind,
        resolutionCeiling: ceiling,
        sourceResolution: resolutionOf(videoStream),
        outputResolution: null as string | null,
        deinterlaced: facts.videoCodec === 'av1' && parity ? true : null,
      };
    });
    if (encode) {
      try {
        const { metadata: out } = await getMetadata(workingPath);
        encode.outputResolution = resolutionOf((out.streams as any[]).find((s) => s.codec_type === 'video'));
      } catch (err) {
        console.warn('[encode] tag fact OUTPUT_RESOLUTION omitted:', err instanceof Error ? err.message : err);
      }
      Object.assign(video, encode);
      if (encode.videoCodec === 'av1') {
        video.grainApplied = filmGrain;
        video.grainDecidedBy = grainDecidedBy ?? null;
      }
    }
    return { global: buildGlobalTagsXml(global), video: buildVideoTagsXml(video) };
  };
  const ffmpegCommand = await runFfmpeg(
    args,
    workingPath,
    partPath,
    output,
    durationSeconds,
    onProgress,
    signal,
    tags,
  );

  return { ffmpegCommand };
};
