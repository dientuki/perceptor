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
    ...getVideoParams(vStream, details.contentKind, details.compressionResolution, quality),
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
    ),
    "-map_metadata:g",
    "-1",
    "-metadata",
    `title=${details.containerTitle}`,
    "-metadata",
    `PERCEPTOR_SOURCE=${details.sourceTag}`,
  ];

  const sampleSeconds = process.env.ENCODE_SAMPLE_SECONDS;
  if (sampleSeconds) {
    args.push("-t", sampleSeconds);
  }

  args.push("-y", output);

  return args;
}
