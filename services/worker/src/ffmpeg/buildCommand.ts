import { getVideoParams, getAudioParams, getSubtitleParams } from './params';
import { isRemux } from './remux-detection';
import type { EncodeInput } from '../encode/types';

interface FfmpegMetadata {
  streams: Array<{
    codec_name?: string;
    codec_type?: "video" | "audio" | "subtitle";
    language?: string;
    channels?: number;
    bit_rate?: string;
    [key: string]: any;
  }>;
  format?: {
    tags?: {
      title?: string;
    };
  };
}

export function buildFfmpegCommand(
  input: string,
  output: string,
  metadata: FfmpegMetadata,
  details: EncodeInput,
  filmGrain: boolean,
  trimAt: number | null,
  subtitleDrops: ReadonlySet<number>,
): string[] {
  const vStream = metadata.streams.find((s) => s.codec_type === "video");
  const aStreams = metadata.streams.filter((s) => s.codec_type === "audio");
  const sStreams = metadata.streams.filter((s) => s.codec_type === "subtitle");

  // Spec 011, REQ-10
  const quality = isRemux(metadata, input) ? "remux" : "web";

  const args = [
    "-i",
    input,
    "-threads",
    "0",
    "-progress",
    "pipe:1",
    "-nostats",
    "-loglevel",
    "error",
    ...getVideoParams(vStream, details.contentKind, details.compressionResolution, quality, filmGrain),
    ...getAudioParams(
      aStreams,
      details.allowedAudioLanguagesIso3,
      details.originalLanguageIso3,
      details.allowedAudioLanguageTags,
      details.trackTitles,
    ),
    ...getSubtitleParams(
      sStreams,
      details.allowedSubtitleFormats,
      details.allowedSubtitleLanguagesIso3,
      details.allowedSubtitleLanguageTags,
      details.trackTitles,
      subtitleDrops,
    ),
    "-map_metadata:g",
    "-1",
    "-metadata",
    `title=${details.containerTitle}`,
    "-metadata",
    `PERCEPTOR_SOURCE=${details.sourceTag}`,
  ];

  // Spec 098, REQ-8
  const sampleSeconds = Number.parseFloat(process.env.ENCODE_SAMPLE_SECONDS ?? "");
  const limits = [trimAt, Number.isFinite(sampleSeconds) && sampleSeconds > 0 ? sampleSeconds : null]
    .filter((n): n is number => n !== null);
  if (limits.length > 0) {
    args.push("-t", Math.min(...limits).toFixed(3));
  }

  args.push("-y", output);

  return args;
}
