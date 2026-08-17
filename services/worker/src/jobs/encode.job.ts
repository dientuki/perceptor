import type { Job } from 'bullmq';
import { fetchGraphQL } from '../api/graphql-client';
import { buildOutputPath } from '../paths/build-output-path';
import { encode } from '../encode';
import { cleanupSource } from './cleanup-source';
import type { EncodeJob } from '../queue/types';

export type EncodeJobDetails = {
  id: number;
  status: string;
  inputFilePath: string;
  kind: string; // 'MOVIE' | 'EPISODE'
  tmdbId: number;
  title: string;
  year: number | null;
  originalLanguage: string;
  originalLanguageIso3: string;
  allowedLanguagesIso3: string[];
  isLiveAction: boolean;
  seasonNumber: number | null;
  episodeNumber: number | null;
  episodeTitle: string | null;
  mediaSourceId: number;
  sourceKind: string;
  infoHash: string | null;
  downloadPath: string | null;
  outputRoot: string;
  downloadsRoot: string;
};

type ProcessJobQueryResult = {
  processJob: EncodeJobDetails | null;
};

// Mínimo salto de progreso entre mutations a la api. Con el mock (10 pasos)
// esto ya viene grueso; con FFmpeg real (stderr cada pocos ms) es lo que evita
// convertir un encode de 2 horas en una mutation por línea de log.
const PROGRESS_STEP = 5;

export async function handleEncode(job: Job<EncodeJob>): Promise<void> {
  const { processJobId } = job.data;

  const { processJob: details } = await fetchGraphQL<ProcessJobQueryResult>(
    `query ($id: Int!) {
      processJob(id: $id) {
        id status inputFilePath kind tmdbId title year originalLanguage originalLanguageIso3 allowedLanguagesIso3 isLiveAction
        seasonNumber episodeNumber episodeTitle
        mediaSourceId sourceKind infoHash downloadPath outputRoot downloadsRoot
      }
    }`,
    { id: processJobId },
  );

  if (!details) {
    throw new Error(`processJob ${processJobId} no existe`);
  }

  console.log(
    `[encode] ${processJobId}: allowedLanguagesIso3=${JSON.stringify(details.allowedLanguagesIso3)} originalLanguageIso3=${details.originalLanguageIso3}`,
  );

  try {
    const outputPath = buildOutputPath(details);

    await fetchGraphQL(
      `mutation ($id: Int!) { encodeStarted(processJobId: $id) }`,
      { id: processJobId },
    );

    let lastReported = -1;
    // Awaited, no fire-and-forget: dos updates concurrentes sobre el mismo
    // ProcessJob (un progreso todavía en vuelo + el encodeCompleted de más
    // abajo) chocan contra el PrismaService singleton (una sola conexión vía
    // PrismaMariaDb) con "Record has changed since last read" (MariaDB 1020).
    // Esperar cada mutation antes de seguir el loop del encode lo evita del
    // todo. Un progreso perdido sí se traga (no debe frenar el encode).
    const onProgress = async (progress: number) => {
      if (progress !== 100 && progress - lastReported < PROGRESS_STEP) return;
      lastReported = progress;

      try {
        await fetchGraphQL(
          `mutation ($id: Int!, $p: Int!) { encodeProgress(processJobId: $id, progress: $p) }`,
          { id: processJobId, p: progress },
        );
      } catch (err) {
        console.error(`[encode] no se pudo reportar progreso de ${processJobId}:`, err);
      }
    };

    const { ffmpegCommand } = await encode(
      details.inputFilePath,
      outputPath,
      {
        originalLanguageIso3: details.originalLanguageIso3,
        allowedLanguagesIso3: details.allowedLanguagesIso3,
        isLiveAction: details.isLiveAction,
      },
      onProgress,
    );

    await fetchGraphQL(
      `mutation ($id: Int!, $out: String!, $cmd: String!) {
        encodeCompleted(processJobId: $id, outputFilePath: $out, ffmpegCommand: $cmd)
      }`,
      { id: processJobId, out: outputPath, cmd: ffmpegCommand },
    );

    console.log(`[encode] ${processJobId}: completado -> ${outputPath}`);

    // El aviso al media server (Jellyfin, si está configurado) lo dispara el
    // api dentro de encodeCompleted — tiene las settings y las raíces, el
    // worker no necesita enterarse.
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await fetchGraphQL(
      `mutation ($id: Int!, $msg: String!) { encodeFailed(processJobId: $id, errorMessage: $msg) }`,
      { id: processJobId, msg: errorMessage },
    ).catch((err) => console.error(`[encode] no se pudo reportar el fallo de ${processJobId}:`, err));

    throw error;
  }

  // Cleanup runs after the encode's try/catch has already closed: the job is
  // already reported completed at this point, and nothing here may flip it
  // back to failed. cleanupSource itself never throws (see its header
  // comment), but this second try is a deliberate line of defence in case it
  // ever does despite that contract.
  try {
    await cleanupSource({
      mediaSourceId: details.mediaSourceId,
      sourceKind: details.sourceKind,
      infoHash: details.infoHash,
      downloadPath: details.downloadPath,
      downloadsRoot: details.downloadsRoot,
    });
  } catch (err) {
    console.error(`[encode] ${processJobId}: cleanupSource falló inesperadamente:`, err);
  }
}
