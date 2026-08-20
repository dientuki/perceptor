import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { ProcessQueueService } from '@/queue/process-queue.service';
import { ERROR_KEYS } from '@/i18n/error-keys';
import { MESSAGES_EN } from '@/i18n/messages.en';

@Injectable()
export class DownloadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: ProcessQueueService,
  ) {}

  async handleTorrentCompleted(infoHash: string): Promise<string> {
    const mediaSource = await this.prisma.mediaSource.findUnique({
      where: { infoHash },
      include: { movie: true, episode: true },
    });

    // El AutoRun dispara para TODOS los torrents del cliente, incluso los que no
    // agregó Perceptor (hay varios previos en este qBittorrent). Un hash
    // desconocido no es un error: se ignora y se avisa.
    if (!mediaSource) {
      console.log(`[torrentCompleted] ignorado: ${infoHash} no corresponde a ningún MediaSource`);
      return `ignorado: ${infoHash} no corresponde a ningún MediaSource`;
    }

    // Idempotencia: el AutoRun puede volver a disparar, por ejemplo si se fuerza
    // un re-check del torrent.
    if (mediaSource.status === 'READY' || mediaSource.status === 'SCANNED') {
      console.log(
        `[torrentCompleted] ya procesado: mediaSource ${mediaSource.id} en estado ${mediaSource.status}`,
      );
      return `ya procesado: mediaSource ${mediaSource.id} en estado ${mediaSource.status}`;
    }

    // Una fila ya degradada a ERROR (por ejemplo, reemplazada con force) fue
    // superada por un pedido más nuevo. Un torrentCompleted tardío para ese hash
    // no debe mover nada.
    if (mediaSource.status === 'ERROR') {
      console.log(
        `[torrentCompleted] ignorado: mediaSource ${mediaSource.id} está en ERROR (reemplazado)`,
      );
      return `ignorado: mediaSource ${mediaSource.id} está en ERROR (reemplazado)`;
    }

    // Las filas viejas (previas al savepath por torrent) no tienen path, así que
    // no hay nada que decirle al worker. Se marca ERROR para que no quede colgada
    // en DOWNLOADING para siempre.
    if (!mediaSource.downloadPath) {
      const errorMessage = MESSAGES_EN[ERROR_KEYS.SOURCE_NO_DOWNLOAD_PATH];
      await this.prisma.mediaSource.update({
        where: { id: mediaSource.id },
        data: {
          status: 'ERROR',
          errorMessage,
          errorKey: ERROR_KEYS.SOURCE_NO_DOWNLOAD_PATH,
          errorParams: null,
        },
      });
      console.error(`[torrentCompleted] mediaSource ${mediaSource.id}: ${errorMessage}`);
      return `error: mediaSource ${mediaSource.id} sin downloadPath, marcado ERROR`;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.mediaSource.update({
        where: { id: mediaSource.id },
        data: { status: 'READY' }, // READY = "Archivos disponibles en disco"
      });

      if (mediaSource.movie) {
        await tx.movie.update({
          where: { id: mediaSource.movie.id },
          data: { status: 'ENCODING' },
        });
      }

      if (mediaSource.episode) {
        await tx.episode.update({
          where: { id: mediaSource.episode.id },
          data: { status: 'ENCODING' },
        });
      }
    });

    await this.queue.addSourceReady({ mediaSourceId: mediaSource.id });

    console.log(`[torrentCompleted] encolado: mediaSource ${mediaSource.id}`);
    return `encolado: mediaSource ${mediaSource.id}`;
  }
}
