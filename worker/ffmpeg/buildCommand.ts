import { getVideoParams, getAudioParams, getSubtitleParams } from "./params";

export function buildFfmpegCommand(
  input: string,
  output: string,
  metadata: any,
  languageIso3: string
): string[] {
  const vStream = metadata.streams.find((s: any) => s.codec_type === "video");
  const aStreams = metadata.streams.filter((s: any) => s.codec_type === "audio");
  const sStreams = metadata.streams.filter((s: any) => s.codec_type === "subtitle");

  return [
    "-i", input,
    "-threads", "0",
    //"-t", "00:01:00", // Solo para pruebas, elimina esto después
    ...getVideoParams(vStream),
    ...getAudioParams(aStreams, languageIso3),
    ...getSubtitleParams(sStreams, languageIso3),
    "-map_metadata:g", "-1",
    "-y",
    output
  ];
}