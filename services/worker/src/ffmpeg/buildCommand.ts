import { getVideoParams, getAudioParams, getSubtitleParams } from './params';
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

  // Detectamos si es REMUX buscando la palabra en el nombre del archivo o en el título del metadata
  const isRemux = input.toLowerCase().includes("remux") ||
                  (metadata.format?.tags?.title || "").toLowerCase().includes("remux");
  const quality = isRemux ? "remux" : "web";

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
    ...getAudioParams(aStreams, details.originalLanguageIso3),
    ...getSubtitleParams(sStreams, details.originalLanguageIso3),
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
