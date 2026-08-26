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

  // REQ-10: remux detection reads the ffprobe metadata, not the filename.
  // The filename is only consulted inside isRemux itself, as the last resort
  // when no bitrate at all can be computed (src/ffmpeg/remux-detection.ts).
  const quality = isRemux(metadata, input) ? "remux" : "web";

  // -progress pipe:1: emite out_time_us=/progress= por stdout en formato
  // key=value, que runner.ts parsea para reportar progreso real (antes no
  // existía ningún parseo, sólo se imprimía la línea cruda de stderr).
  // -nostats -loglevel error: sin esto ffmpeg también manda su resumen de
  // progreso normal a stderr, duplicando y ensuciando lo que runner.ts lee ahí
  // para el mensaje de error.
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
    ...getVideoParams(vStream, details.isLiveAction, quality),
    ...getAudioParams(aStreams, details.allowedLanguagesIso3, details.originalLanguageIso3),
    ...getSubtitleParams(sStreams, details.allowedLanguagesIso3),
    "-map_metadata:g",
    "-1",
  ];

  // Sólo mientras se prueba el workflow: encodear unos pocos segundos en vez
  // del archivo completo. Ver ENCODE_SAMPLE_SECONDS en .env.example.
  const sampleSeconds = process.env.ENCODE_SAMPLE_SECONDS;
  if (sampleSeconds) {
    args.push("-t", sampleSeconds);
  }

  args.push("-y", output);

  return args;
}
