import { getVideoParams, getAudioParams, getSubtitleParams } from "@/worker/ffmpeg/params";
import { getIso3FromIso2 } from "@/models/languages.model";
import { JobWithDetails } from "@/models/jobs.model";
import { MediaType } from "@prisma/client";

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

export async function buildFfmpegCommand(
  input: string,
  output: string,
  metadata: FfmpegMetadata,
  job: JobWithDetails
): Promise<string[]> {
  const vStream = metadata.streams.find((s) => s.codec_type === "video");
  const aStreams = metadata.streams.filter((s) => s.codec_type === "audio");
  const sStreams = metadata.streams.filter((s) => s.codec_type === "subtitle");

  let originalIso2 = "en";
  let isLiveAction = true; // Default to true for movies if not specified

  if (job.mediaType === MediaType.TV && job.episode) {
    originalIso2 = job.episode.season.show.originalLanguage;
    isLiveAction = job.episode.season.show.isLiveAction;
  } else if (job.mediaType === MediaType.MOVIE && job.movie) {
    originalIso2 = job.movie.originalLanguage;
    isLiveAction = job.movie.isLiveAction;
  }

  const languageIso3 = (await getIso3FromIso2(originalIso2)) ?? "eng";

  // Detectamos si es REMUX buscando la palabra en el nombre del archivo o en el título del metadata
  const isRemux = input.toLowerCase().includes("remux") || 
                  (metadata.format?.tags?.title || "").toLowerCase().includes("remux");
  const quality = isRemux ? "remux" : "web";

  return [
    "-i",
    input,
    "-threads",
    "0",
    //"-t", "00:05:00", // Solo para pruebas, elimina esto después
    ...getVideoParams(vStream, isLiveAction, quality),
    ...getAudioParams(aStreams, languageIso3),
    ...getSubtitleParams(sStreams, languageIso3),
    "-map_metadata:g",
    "-1",
    "-y",
    output,
  ];
}