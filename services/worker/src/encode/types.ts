import type { CompressionResolution } from './compression-resolution';
import type { ContentKind } from './content-kind';
import type { GrainMode } from './grain-mode';
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
  grainMode: GrainMode;
  // Spec 094, REQ-1
  year: number | null;
  isShort: boolean;
  // Spec 098, REQ-3
  dubTrimEnabled: boolean;
  // Spec 099, REQ-3
  streamEndTrimEnabled: boolean;
  // Spec 110, REQ-5
  audioVariantDetection?: boolean;
  mediaSourceId: number;
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
