import type { CompressionResolution } from './compression-resolution';
import type { ContentKind } from './content-kind';
import type { SubtitleFormat } from './subtitle-formats';

export type EncodeInput = {
  originalLanguageIso3: string;
  allowedAudioLanguagesIso3: string[];
  allowedAudioLanguageTags: string[];
  allowedSubtitleLanguagesIso3: string[];
  allowedSubtitleLanguageTags: string[];
  allowedSubtitleFormats: SubtitleFormat[];
  contentKind: ContentKind;
  compressionResolution: CompressionResolution;
  containerTitle: string;
  sourceTag: string;
  trackTitles: Record<string, string>;
};

// Spec 053, AC-8
export type EncodeFn = (
  input: string,
  output: string,
  details: EncodeInput,
  onProgress: (progress: number, speed: number | null) => Promise<void>,
  onProbe: (file: string, ffprobe: string) => Promise<void>,
  signal: AbortSignal,
) => Promise<{ ffmpegCommand: string }>;
