import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { SourceFileInput } from './dto/source-file.input';

const NO_VIDEO_REASON = 'No es el archivo de video principal del release';

@Injectable()
export class MediaSourcesService {
  constructor(private readonly prisma: PrismaService) {}

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

      // El SourceFile ganador se upsertea primero (junto con el resto) para tener
      // su id disponible antes de crear el ProcessJob.
      let matchedSourceFileId: number | null = null;
      for (const file of files) {
        const isMatched = matchedFilePath !== null && file.filePath === matchedFilePath;
        const data = {
          fileName: file.fileName,
          size: file.size != null ? BigInt(Math.round(file.size)) : null,
          status: isMatched ? ('MATCHED' as const) : ('IGNORED' as const),
          reason: isMatched ? null : NO_VIDEO_REASON,
          movieId: isMatched ? movieId : null,
        };

        const sourceFile = await tx.sourceFile.upsert({
          where: { mediaSourceId_filePath: { mediaSourceId, filePath: file.filePath } },
          create: { mediaSourceId, filePath: file.filePath, ...data },
          update: data,
        });

        if (isMatched) matchedSourceFileId = sourceFile.id;
      }

      // Carpeta vacía o sin video: única rama de error que maneja la api. Se
      // upsertea el inventario igual (es diagnóstico), no se crea ProcessJob.
      if (matchedFilePath === null) {
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

      // Find-or-create: si ya existe un ProcessJob para este SourceFile no se
      // toca ni se resetea — un re-scan no puede tirar para atrás un job que ya
      // está ENCODING.
      if (matchedSourceFileId) {
        const existing = await tx.processJob.findUnique({
          where: { sourceFileId: matchedSourceFileId },
        });

        if (existing) {
          console.log(
            `[sourceScanned] ProcessJob ${existing.id} ya existe para sourceFile ${matchedSourceFileId}, no se toca`,
          );
        } else {
          await tx.processJob.create({
            data: {
              sourceFileId: matchedSourceFileId,
              movieId,
              episodeId: mediaSource.episodeId,
              status: 'WAITING',
            },
          });
        }
      }

      // SCANNED = "Archivos inventariados en source_files". errorMessage se
      // limpia para que un re-scan exitoso borre el diagnóstico del intento
      // anterior. Movie.status no se toca: downloads.service ya lo puso en
      // ENCODING y sigue siendo verdad.
      await tx.mediaSource.update({
        where: { id: mediaSourceId },
        data: { status: 'SCANNED', errorMessage: null },
      });
    });

    return this.findOneFlat(mediaSourceId);
  }
}
