import { rm } from 'node:fs/promises';
import type { Job } from 'bullmq';
import { fetchGraphQL } from '../api/graphql-client';
import { buildOutputPath } from '../paths/build-output-path';
import { encode } from '../encode';
import type { EncodeJob } from '../queue/types';

export type EncodeJobDetails = {
  id: number;
  status: string;
  inputFilePath: string;
  kind: string; // 'MOVIE' | 'EPISODE'
  title: string;
  year: number | null;
  originalLanguage: string;
  isLiveAction: boolean;
  seasonNumber: number | null;
  episodeNumber: number | null;
  episodeTitle: string | null;
  mediaSourceId: number;
  sourceKind: string;
  infoHash: string | null;
  downloadPath: string | null;
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
        id status inputFilePath kind title year originalLanguage isLiveAction
        seasonNumber episodeNumber episodeTitle
        mediaSourceId sourceKind infoHash downloadPath
      }
    }`,
    { id: processJobId },
  );

  if (!details) {
    throw new Error(`processJob ${processJobId} no existe`);
  }

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

    const { ffmpegCommand } = await encode(details.inputFilePath, outputPath, onProgress);

    await fetchGraphQL(
      `mutation ($id: Int!, $out: String!, $cmd: String!) {
        encodeCompleted(processJobId: $id, outputFilePath: $out, ffmpegCommand: $cmd)
      }`,
      { id: processJobId, out: outputPath, cmd: ffmpegCommand },
    );

    console.log(`[encode] ${processJobId}: completado -> ${outputPath}`);

    // Sólo para torrents (infoHash no null): liberar el cliente y limpiar el
    // savepath. La api no puede borrar la carpeta — no tiene montado el
    // volumen de descargas — así que ese paso lo hace el worker.
    if (details.infoHash) {
      await fetchGraphQL(
        `mutation ($id: Int!) { downloadRemove(mediaSourceId: $id) }`,
        { id: details.mediaSourceId },
      );

      if (details.downloadPath) {
        await rm(details.downloadPath, { recursive: true, force: true });
      }
    }

    // TODO: cliente de Jellyfin (config ya sembrada en `settings`, código
    // todavía no existe). Por ahora, sólo loguea.
    console.log(`[encode] TODO avisar al media server: ${outputPath}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await fetchGraphQL(
      `mutation ($id: Int!, $msg: String!) { encodeFailed(processJobId: $id, errorMessage: $msg) }`,
      { id: processJobId, msg: errorMessage },
    ).catch((err) => console.error(`[encode] no se pudo reportar el fallo de ${processJobId}:`, err));

    throw error;
  }
}
