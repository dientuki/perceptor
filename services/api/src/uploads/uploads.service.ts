import { Injectable, OnModuleInit } from '@nestjs/common';
import { join } from 'node:path';
import { mkdir, rename } from 'node:fs/promises';
import { Server } from '@tus/server';
import { FileStore } from '@tus/file-store';
import { PrismaService } from '@/prisma/prisma.service';
import { SettingsService } from '@/settings/settings.service';
import { ProcessQueueService } from '@/queue/process-queue.service';

const ILLEGAL_CHARS = /[<>:"/\\|?*\x00-\x1F]/g;

function sanitizeFilename(name: string): string {
  return name.replace(ILLEGAL_CHARS, '').trim() || 'video';
}

// onUploadFinish corre dentro del manejo propio de tus, no del pipeline HTTP
// de Nest — un ConflictException/NotFoundException normal llega ahí como un
// Error más y tus lo devuelve como 500 genérico. tus sí sabe leer
// error.status_code/error.body (ver @tus/server/dist/server.js::onError), así
// que se arma el error con esa forma para que el browser reciba el código
// real.
class UploadFinishError extends Error {
  status_code: number;
  body: string;

  constructor(status_code: number, message: string) {
    super(message);
    this.status_code = status_code;
    this.body = message;
  }
}

/**
 * Arma y expone el server de tus (protocolo de subida reanudable) para que
 * UploadsController le delegue el request crudo. Se construye recién en
 * onModuleInit porque el directorio destino sale de `settings.path_downloads`
 * (async, vía Prisma) — Nest espera todos los onModuleInit antes de escuchar,
 * así que el server ya está listo para cuando llega el primer request.
 */
@Injectable()
export class UploadsService implements OnModuleInit {
  server!: Server;
  private uploadsDir!: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly queue: ProcessQueueService,
  ) {}

  async onModuleInit() {
    const config = await this.settings.getMap();
    const basePath = config.path_downloads ?? '/media/downloads';
    this.uploadsDir = join(basePath, 'uploads');

    this.server = new Server({
      path: '/uploads',
      datastore: new FileStore({ directory: this.uploadsDir }),
      // Traefik está adelante: sin esto el Location que arma tus sale con el
      // host/proto internos del container en vez de los que vio el browser.
      respectForwardedHeaders: true,
      onUploadFinish: async (req, upload) => {
        try {
          await this.handleUploadFinish(upload);
        } catch (err) {
          console.error(`[uploads] ${upload.id}: falló el cierre de la subida:`, err);
          throw err;
        }
        return {};
      },
    });
  }

  private async handleUploadFinish(upload: {
    id: string;
    metadata?: Record<string, string | null>;
    storage?: { path: string };
  }) {
    const movieId = Number(upload.metadata?.movieId);
    const filename = sanitizeFilename(upload.metadata?.filename || upload.id);
    const rawPath = upload.storage?.path;

    if (!movieId || !rawPath) {
      throw new UploadFinishError(400, 'Metadata de la subida incompleta (movieId/filename)');
    }

    const movie = await this.prisma.movie.findUnique({ where: { id: movieId } });
    if (!movie) throw new UploadFinishError(404, `La película ${movieId} no existe`);

    if (movie.mediaSourceId) {
      throw new UploadFinishError(
        409,
        'Esta película ya tiene una descarga en curso. Confirmá para reemplazarla.',
      );
    }

    // FileStore escribe los bytes planos como <uploadsDir>/<id> — un archivo,
    // no una carpeta. El destino no puede reusar ese mismo nombre (mkdir
    // pisaría el propio archivo que se está moviendo), así que las subidas ya
    // cerradas van a su propio namespace "imports/<id>/<filename>", mismo
    // criterio que qBittorrent (client.ts::add) de una carpeta por descarga.
    const destDir = join(this.uploadsDir, 'imports', upload.id);
    const destPath = join(destDir, filename);
    await mkdir(destDir, { recursive: true });
    await rename(rawPath, destPath);

    const mediaSource = await this.prisma.mediaSource.create({
      data: {
        kind: 'LOCAL_FILE',
        status: 'READY',
        downloadPath: destPath,
        releaseTitle: upload.metadata?.filename ?? null,
      },
    });

    await this.prisma.movie.update({
      where: { id: movieId },
      data: { mediaSourceId: mediaSource.id, status: 'ENCODING' },
    });

    await this.queue.addSourceReady({ mediaSourceId: mediaSource.id });

    console.log(`[uploads] ${upload.id}: completado -> mediaSource ${mediaSource.id}, encolado`);
  }
}
