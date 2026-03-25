import { getVideoParams, getAudioParams, getSubtitleParams } from "@/worker/ffmpeg/params";
import { getIso3FromIso2 } from "@/models/languages.model";
import { JobWithDetails } from "@/models/jobs.model";
import { MediaType } from "@prisma/client";

export async function buildFfmpegCommand(
  input: string,
  output: string,
  metadata: any,
  job: JobWithDetails
): Promise<string[]> {
  const vStream = metadata.streams.find((s: any) => s.codec_type === "video");
  const aStreams = metadata.streams.filter((s: any) => s.codec_type === "audio");
  const sStreams = metadata.streams.filter(
    (s: any) => s.codec_type === "subtitle"
  );

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

  return [
    "-i",
    input,
    "-threads",
    "0",
    //"-t", "00:01:00", // Solo para pruebas, elimina esto después
    ...getVideoParams(vStream, isLiveAction),
    ...getAudioParams(aStreams, languageIso3),
    ...getSubtitleParams(sStreams, languageIso3),
    "-map_metadata:g",
    "-1",
    "-y",
    output,
  ];
}