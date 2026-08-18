import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { SourceFileInput } from './dto/source-file.input';
import { ScannedMatchInput } from './dto/scanned-match.input';
import { EncodeQueueService } from '@/queue/encode-queue.service';

@Injectable()
export class MediaSourcesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encodeQueue: EncodeQueueService,
  ) {}

  // MediaSource no tiene columna movieId: el dueño del 1:1 es Movie.mediaSourceId.
  // Se aplana acá para que tanto la query como la mutation devuelvan la misma forma.
  private async findOneFlat(id: number) {
    const mediaSource = await this.prisma.mediaSource.findUnique({
      where: { id },
      include: { movie: { select: { id: true } } },
    });
    if (!mediaSource) return null;

    return { ...mediaSource, movieId: mediaSource.movie?.id ?? null };
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
        throw new NotFoundException(`El mediaSource ${mediaSourceId} no existe`);
      }

      const movieId = mediaSource.movie?.id ?? null;

      // Sin early-return: un mediaSource ya SCANNED se re-escanea igual y
      // converge (upsert), en vez de hacer un no-op silencioso de un re-scan
      // legítimo.
      if (mediaSource.status === 'SCANNED') {
        console.log(`[sourceScanned] mediaSource ${mediaSourceId} ya estaba SCANNED, re-escaneando`);
      }

      if (!movieId && !mediaSource.episodeId && !mediaSource.season) {
        throw new BadRequestException(
          `El mediaSource ${mediaSourceId} no apunta a ninguna película, episodio ni temporada`,
        );
      }

      // El .find() valida que cada match.filePath sea uno de los archivos que el
      // worker reportó haber escaneado, aunque de la fila en sí ya no se
      // persista nada más que filePath (fileName/size vivían sólo para
      // mostrarse, y nunca se leyeron de vuelta — ver plan).
      for (const match of matches) {
        const inFiles = files.some((file) => file.filePath === match.filePath);
        if (!inFiles) {
          throw new BadRequestException(
            `matchedFilePath ${match.filePath} no está en la lista de files reportada`,
          );
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

      // hasUnmatchedFiles: sólo cuenta lo que el worker marcó como video y que
      // no terminó resuelto — un .nfo/.srt nunca lo activa (ver dto isVideo).
      const resolvedPaths = new Set(resolvedMatches.map((m) => m.filePath));
      const hasUnmatchedFiles = files.some((file) => file.isVideo && !resolvedPaths.has(file.filePath));

      if (resolvedMatches.length === 0) {
        // Carpeta vacía, sin video, o (para una temporada) ningún video se pudo
        // resolver a un episodio: única rama de error que maneja la api. No se
        // crea ningún SourceFile ni ProcessJob.
        const errorMessage = 'Escaneo sin archivo de video principal: carpeta vacía o sin video';

        await tx.mediaSource.update({
          where: { id: mediaSourceId },
          data: { status: 'ERROR', errorMessage, hasUnmatchedFiles },
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
        data: { status: 'SCANNED', errorMessage: null, hasUnmatchedFiles },
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
