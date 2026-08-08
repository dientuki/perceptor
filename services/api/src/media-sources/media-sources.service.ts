import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { SourceFileInput } from './dto/source-file.input';
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

  async sourceScanned(
    mediaSourceId: number,
    files: SourceFileInput[],
    matchedFilePath: string | null,
  ) {
    // Ids de ProcessJob a encolar en bull:encode. Se juntan durante la
    // transacción pero se encolan después de commitear (ver más abajo): si se
    // encolara adentro, el worker podría tomar el job antes de que la fila
    // exista para él.
    const processJobIdsToQueue: number[] = [];

    await this.prisma.$transaction(async (tx) => {
      const mediaSource = await tx.mediaSource.findUnique({
        where: { id: mediaSourceId },
        include: { movie: { select: { id: true } } },
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

      // SourceFile no es un inventario de la carpeta: es "qué archivo pertenece
      // a esta película/episodio". Un torrent puede traer el .mkv junto con
      // varios .nfo, samples o .parts — sólo el ganador (el video más grande,
      // ya elegido por el worker en matchedFilePath) se persiste.
      if (matchedFilePath === null) {
        // Carpeta vacía o sin video: única rama de error que maneja la api.
        // No se crea ningún SourceFile.
        const errorMessage = 'Escaneo sin archivo de video principal: carpeta vacía o sin video';

        await tx.mediaSource.update({
          where: { id: mediaSourceId },
          data: { status: 'ERROR', errorMessage },
        });

        // Un paso más allá de lo pedido: si no se marca la película, queda en
        // ENCODING para siempre esperando un encode que nunca se va a encolar.
        if (movieId) {
          await tx.movie.update({ where: { id: movieId }, data: { status: 'ERROR' } });
        }

        return;
      }

      // El .find() valida que matchedFilePath sea uno de los archivos que el
      // worker reportó haber escaneado, aunque de la fila en sí ya no se
      // persista nada más que filePath (fileName/size vivían sólo para
      // mostrarse, y nunca se leyeron de vuelta — ver plan).
      const matchedFile = files.find((file) => file.filePath === matchedFilePath);
      if (!matchedFile) {
        throw new BadRequestException(
          `matchedFilePath ${matchedFilePath} no está en la lista de files reportada`,
        );
      }

      const sourceFile = await tx.sourceFile.upsert({
        where: { mediaSourceId_filePath: { mediaSourceId, filePath: matchedFilePath } },
        create: { mediaSourceId, filePath: matchedFilePath, movieId },
        update: { movieId },
      });
      const matchedSourceFileId = sourceFile.id;

      // Find-or-create: si ya existe un ProcessJob para este SourceFile no se
      // toca ni se resetea — un re-scan no puede tirar para atrás un job que ya
      // está ENCODING.
      const existing = await tx.processJob.findUnique({
        where: { sourceFileId: matchedSourceFileId },
      });

      if (existing) {
        // WAITING acá significa que la fila se creó en un re-scan anterior
        // pero nunca se llegó a encolar (por ejemplo, si el add() de abajo
        // falló esa vez) — este re-scan es la palanca para recuperarlo. Si
        // ya está QUEUED/ENCODING/COMPLETED/ERROR no se toca.
        if (existing.status === 'WAITING') {
          processJobIdsToQueue.push(existing.id);
        } else {
          console.log(
            `[sourceScanned] ProcessJob ${existing.id} ya existe para sourceFile ${matchedSourceFileId}, no se toca`,
          );
        }
      } else {
        const created = await tx.processJob.create({
          data: {
            sourceFileId: matchedSourceFileId,
            movieId,
            episodeId: mediaSource.episodeId,
            status: 'WAITING',
          },
        });
        processJobIdsToQueue.push(created.id);
      }

      // SCANNED = "el archivo del release quedó identificado en source_files".
      // errorMessage se limpia para que un re-scan exitoso borre el diagnóstico
      // del intento anterior. Movie.status no se toca: downloads.service ya lo
      // puso en ENCODING y sigue siendo verdad.
      await tx.mediaSource.update({
        where: { id: mediaSourceId },
        data: { status: 'SCANNED', errorMessage: null },
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
