import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { SourceFileInput } from './dto/source-file.input';
import { ScannedMatchInput } from './dto/scanned-match.input';
import { EncodeQueueService } from '@/queue/encode-queue.service';
import { ERROR_KEYS } from '@/i18n/error-keys';
import { i18nError } from '@/i18n/i18n-error';
import { MESSAGES_EN } from '@/i18n/messages.en';
import { QbittorrentClient } from '@/clients/torrent/client';

@Injectable()
export class MediaSourcesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encodeQueue: EncodeQueueService,
    private readonly torrentClient: QbittorrentClient,
  ) {}

  // Resolved on demand (@ResolveField), never eagerly — NFR-1: one torrent-
  // client call per asking caller, zero for everyone else. `null` means
  // "nobody knows" (no infoHash, unknown hash, client unreachable), which the
  // worker reads as "fall back to today's behaviour" (REQ-2/REQ-4/REQ-8) —
  // never `[]`, which would instead mean "the client answered, nothing was
  // downloaded" and fail the scan under REQ-7.
  async downloadedFiles(source: { infoHash: string | null }): Promise<string[] | null> {
    if (!source.infoHash) return null;

    try {
      // Lowercased here too, redundantly with client.ts's own normalisation:
      // an indexer-sourced infoHash is stored uppercase, and qBittorrent
      // answers 404 for it otherwise (../plan.md § Risks).
      const files = await this.torrentClient.files(source.infoHash.toLowerCase());
      return files
        .filter((file) => file.priority !== 0 && file.progress >= 1)
        .map((file) => file.name);
    } catch (error) {
      console.error(
        `[MediaSourcesService] no se pudo resolver downloadedFiles para infoHash ${source.infoHash}:`,
        error,
      );
      return null;
    }
  }

  // MediaSource.movieId is now a real column (022-download-status-tags), no
  // longer derived from Movie's side of a 1:1. Kept as a private wrapper so
  // sourceScanned() below has one read path for the row.
  private async findOneFlat(id: number) {
    return this.prisma.mediaSource.findUnique({ where: { id } });
  }

  async findOne(id: number) {
    return this.findOneFlat(id);
  }

  async sourceScanned(mediaSourceId: number, files: SourceFileInput[], matches: ScannedMatchInput[]) {
    // Ids de ProcessJob a encolar en bull:encode. Se juntan durante la
    // transacción pero se encolan después de commitear (ver más abajo): si se
    // encolara adentro, el worker podría tomar el job antes de que la fila
    // exista para él.
    const processJobIdsToQueue: number[] = [];

    await this.prisma.$transaction(async (tx) => {
      const mediaSource = await tx.mediaSource.findUnique({
        where: { id: mediaSourceId },
        include: {
          movie: { select: { id: true } },
          season: { include: { episodes: { select: { id: true, episodeNumber: true } } } },
        },
      });
      if (!mediaSource) {
        throw i18nError.notFound(ERROR_KEYS.SOURCE_NOT_FOUND, { id: mediaSourceId });
      }

      const movieId = mediaSource.movie?.id ?? null;

      // Sin early-return: un mediaSource ya SCANNED se re-escanea igual y
      // converge (upsert), en vez de hacer un no-op silencioso de un re-scan
      // legítimo.
      if (mediaSource.status === 'SCANNED') {
        console.log(`[sourceScanned] mediaSource ${mediaSourceId} ya estaba SCANNED, re-escaneando`);
      }

      if (!movieId && !mediaSource.episodeId && !mediaSource.season) {
        throw i18nError.badRequest(ERROR_KEYS.SOURCE_NO_TARGET, { id: mediaSourceId });
      }

      // El .find() valida que cada match.filePath sea uno de los archivos que el
      // worker reportó haber escaneado, aunque de la fila en sí ya no se
      // persista nada más que filePath (fileName/size vivían sólo para
      // mostrarse, y nunca se leyeron de vuelta — ver plan).
      for (const match of matches) {
        const inFiles = files.some((file) => file.filePath === match.filePath);
        if (!inFiles) {
          throw i18nError.badRequest(ERROR_KEYS.SOURCE_MATCH_NOT_REPORTED, { filePath: match.filePath });
        }
      }

      // Un episodio o una película ignoran los números parseados por el
      // worker: la búsqueda de S01E02 en el nombre del archivo sólo importa
      // cuando el mediaSource apunta a una temporada entera.
      const episodeIdByNumber = new Map<number, number>();
      if (mediaSource.season) {
        for (const episode of mediaSource.season.episodes) {
          episodeIdByNumber.set(episode.episodeNumber, episode.id);
        }
      }

      const resolvedMatches: { filePath: string; episodeId: number | null }[] = [];

      for (const match of matches) {
        if (mediaSource.episodeId) {
          resolvedMatches.push({ filePath: match.filePath, episodeId: mediaSource.episodeId });
          continue;
        }

        if (movieId) {
          resolvedMatches.push({ filePath: match.filePath, episodeId: null });
          continue;
        }

        // Sólo queda el caso temporada: un match cuyo seasonNumber parseado no
        // coincide con el de la temporada pedida, o cuyo episodeNumber no
        // existe en ella, queda sin resolver — no se adivina.
        if (mediaSource.season) {
          if (match.seasonNumber != null && match.seasonNumber !== mediaSource.season.seasonNumber) {
            console.log(
              `[sourceScanned] mediaSource ${mediaSourceId}: se descarta ${match.filePath} (seasonNumber ${match.seasonNumber} no coincide con la temporada ${mediaSource.season.seasonNumber})`,
            );
            continue;
          }

          const episodeId =
            match.episodeNumber != null ? episodeIdByNumber.get(match.episodeNumber) : undefined;
          if (episodeId === undefined) {
            console.log(
              `[sourceScanned] mediaSource ${mediaSourceId}: se descarta ${match.filePath} (episodeNumber ${match.episodeNumber} sin episodio en la temporada)`,
            );
            continue;
          }

          resolvedMatches.push({ filePath: match.filePath, episodeId });
        }
      }

      // hasUnmatchedFiles: sólo cuenta lo que el worker marcó como video, que
      // efectivamente se descargó (052-deselected-torrent-files, REQ-6) y que
      // no terminó resuelto — un .nfo/.srt nunca lo activa (ver dto isVideo),
      // y un .mkv deseleccionado en el cliente de torrents tampoco.
      const resolvedPaths = new Set(resolvedMatches.map((m) => m.filePath));
      const hasUnmatchedFiles = files.some(
        (file) => file.isVideo && file.isDownloaded && !resolvedPaths.has(file.filePath),
      );

      if (resolvedMatches.length === 0) {
        // Empty folder, no video, or (for a season) no video could be resolved
        // to an episode: the only error branch this service handles. No
        // SourceFile or ProcessJob is created. If video was reported but none
        // of it was downloaded (REQ-7), the message must say that instead of
        // the generic "no video found" — otherwise the downstream ffprobe
        // failure surfaces with a message that names the wrong cause.
        const errorKey = files.some((file) => file.isVideo && !file.isDownloaded)
          ? ERROR_KEYS.SOURCE_SCAN_NO_DOWNLOADED_VIDEO
          : ERROR_KEYS.SOURCE_SCAN_NO_VIDEO;
        const errorMessage = MESSAGES_EN[errorKey];

        await tx.mediaSource.update({
          where: { id: mediaSourceId },
          data: {
            status: 'ERROR',
            errorMessage,
            errorKey,
            errorParams: null,
            hasUnmatchedFiles,
          },
        });

        // Un paso más allá de lo pedido: si no se marca la película, queda en
        // ENCODING para siempre esperando un encode que nunca se va a encolar.
        if (movieId) {
          await tx.movie.update({ where: { id: movieId }, data: { status: 'ERROR' } });
        }

        // Mismo razonamiento para el episodio: sin esto queda en ENCODING
        // para siempre esperando un encode que nunca se va a encolar.
        if (mediaSource.episodeId) {
          await tx.episode.update({
            where: { id: mediaSource.episodeId },
            data: { status: 'ERROR' },
          });
        }

        return;
      }

      for (const resolved of resolvedMatches) {
        // SourceFile no es un inventario de la carpeta: es "qué archivo
        // pertenece a esta película/episodio". Un torrent puede traer el .mkv
        // junto con varios .nfo, samples o .parts — sólo los ganadores (uno
        // por episodio, o el video más grande para una película/episodio
        // suelto, ya elegidos por el worker) se persisten.
        const sourceFile = await tx.sourceFile.upsert({
          where: { mediaSourceId_filePath: { mediaSourceId, filePath: resolved.filePath } },
          create: {
            mediaSourceId,
            filePath: resolved.filePath,
            movieId,
            episodeId: resolved.episodeId,
          },
          update: { movieId, episodeId: resolved.episodeId },
        });
        const sourceFileId = sourceFile.id;

        // Find-or-create: si ya existe un ProcessJob para este SourceFile no se
        // toca ni se resetea — un re-scan no puede tirar para atrás un job que
        // ya está ENCODING.
        const existing = await tx.processJob.findUnique({
          where: { sourceFileId },
        });

        let jobCreatedOrRequeued = false;

        if (existing) {
          // WAITING acá significa que la fila se creó en un re-scan anterior
          // pero nunca se llegó a encolar (por ejemplo, si el add() de abajo
          // falló esa vez) — este re-scan es la palanca para recuperarlo. Si
          // ya está QUEUED/ENCODING/COMPLETED/ERROR no se toca.
          if (existing.status === 'WAITING') {
            processJobIdsToQueue.push(existing.id);
            jobCreatedOrRequeued = true;
          } else {
            console.log(
              `[sourceScanned] ProcessJob ${existing.id} ya existe para sourceFile ${sourceFileId}, no se toca`,
            );
          }
        } else {
          const created = await tx.processJob.create({
            data: {
              sourceFileId,
              movieId,
              episodeId: resolved.episodeId,
              status: 'WAITING',
            },
          });
          processJobIdsToQueue.push(created.id);
          jobCreatedOrRequeued = true;
        }

        // Cada episodio sigue su propio job: para un episodio suelto esto
        // repite lo que DownloadsService ya hizo (inofensivo); para una
        // temporada es el único lugar donde pasa.
        if (jobCreatedOrRequeued && resolved.episodeId) {
          await tx.episode.update({
            where: { id: resolved.episodeId },
            data: { status: 'ENCODING' },
          });
        }
      }

      // SCANNED = "el/los archivo(s) del release quedaron identificados en
      // source_files". errorMessage se limpia para que un re-scan exitoso
      // borre el diagnóstico del intento anterior. Movie.status no se toca:
      // downloads.service ya lo puso en ENCODING y sigue siendo verdad.
      await tx.mediaSource.update({
        where: { id: mediaSourceId },
        data: {
          status: 'SCANNED',
          errorMessage: null,
          errorKey: null,
          errorParams: null,
          hasUnmatchedFiles,
        },
      });
    });

    // Fuera de la transacción, ya commiteada: encolar antes dejaría al worker
    // tomar el job y consultar por GraphQL una fila que todavía no existe.
    // Recién tras el add() exitoso se pasa a QUEUED — si el add() falla, la
    // fila queda en WAITING, que es la verdad (y el próximo re-scan la
    // recupera, ver arriba).
    for (const processJobId of processJobIdsToQueue) {
      await this.encodeQueue.addEncode({ processJobId });
    }
    if (processJobIdsToQueue.length > 0) {
      await this.prisma.processJob.updateMany({
        where: { id: { in: processJobIdsToQueue } },
        data: { status: 'QUEUED' },
      });
    }

    return this.findOneFlat(mediaSourceId);
  }
}
