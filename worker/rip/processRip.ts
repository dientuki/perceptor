import { EncodeStatus } from "@prisma/client";
import { update } from "@/models/jobs.model";
import { getMetadata } from "../ffmpeg/metadata";
import { runFfmpeg } from "../ffmpeg/runner";
import { buildFfmpegCommand } from "../ffmpeg/buildCommand";
import { buildOutputPath } from "../files/buildOutputPath";
import { findMkvFile } from "../files/findMkv";
import { TorrentClient } from "@/torrent/types";
import { JobReadyToRip } from "@/models/types";
import { createMediaServerClient } from "@/mediaServer/createMediaServerClient";

export async function processRip(
  job: JobReadyToRip,
  moviesPath: string,
  torrentClient: TorrentClient
) {
  const mkvFile = findMkvFile(job.root_path);

  const metadata = await getMetadata(mkvFile);

  const outputPath = buildOutputPath(job, moviesPath);

  const ffmpegArgs = buildFfmpegCommand(
    mkvFile,
    outputPath,
    metadata,
    job.tmdb.language.iso3
  );

  await update(job.tmdbId, { encodeStatus: EncodeStatus.ENCODING });

  await runFfmpeg(ffmpegArgs, outputPath);

  await update(job.tmdbId, { encodeStatus: EncodeStatus.COMPLETED });

  await torrentClient.remove(job.infoHash);

  const mediaServerClient = await createMediaServerClient();
  await mediaServerClient.createdMedia(outputPath);
}