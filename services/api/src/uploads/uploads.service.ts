import { Injectable, OnModuleInit } from '@nestjs/common';
import { join } from 'node:path';
import { mkdir, rename } from 'node:fs/promises';
import { Server } from '@tus/server';
import { FileStore } from '@tus/file-store';
import { PrismaService } from '@/prisma/prisma.service';
import { SettingsService } from '@/settings/settings.service';
import { MediaRootsService } from '@/media-roots/media-roots.service';
import { ProcessQueueService } from '@/queue/process-queue.service';
import { UploadTicketsService } from './upload-tickets.service';

const ILLEGAL_CHARS = /[<>:"/\\|?*\x00-\x1F]/g;

function sanitizeFilename(name: string): string {
  return name.replace(ILLEGAL_CHARS, '').trim() || 'video';
}

// onUploadFinish and onUploadCreate both run inside tus's own request
// handling, not Nest's HTTP pipeline — a plain ConflictException/
// NotFoundException thrown there lands as just another Error and tus
// answers with a generic 500. tus does know how to read
// error.status_code/error.body (see @tus/server/dist/server.js::onError),
// so both hooks throw this shape instead, and the browser gets the real
// status code.
class UploadHttpError extends Error {
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
    private readonly mediaRoots: MediaRootsService,
    private readonly queue: ProcessQueueService,
    private readonly uploadTickets: UploadTicketsService,
  ) {}

  async onModuleInit() {
    // Staging FIJO en la raíz completa del mount, no en la setting: tus
    // necesita un directorio estable durante toda la vida del proceso — no se
    // puede reconstruir el Server en cada cambio de path_downloads sin romper
    // las subidas resumibles que estén en curso. Como updateMany() (ver
    // settings.service.ts) garantiza que path_downloads siempre resuelve
    // ADENTRO de esta misma raíz, anclar acá no le saca alcance a la setting
    // — y de paso mantiene el rename() de más abajo dentro del mismo
    // filesystem siempre, nunca cruza de dispositivo.
    const downloadsRoot = await this.mediaRoots.resolveFromRoot('downloads', '.');
    this.uploadsDir = join(downloadsRoot, 'uploads');

    this.server = new Server({
      path: '/uploads',
      datastore: new FileStore({ directory: this.uploadsDir }),
      // Traefik está adelante: sin esto el Location que arma tus sale con el
      // host/proto internos del container en vez de los que vio el browser.
      respectForwardedHeaders: true,
      // Lets the browser's tus client actually send the header the ticket
      // travels in.
      allowedHeaders: ['Authorization'],
      onUploadCreate: (req, upload) => this.onUploadCreate(req, upload),
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

  // Wired into the `Server` options above, alongside registering the global
  // GraphQL guard — both halves of the boundary close in the same commit
  // (plan.md § Phase C). Verified via upload-tickets.service.spec.ts against
  // the ticket logic; this method itself is thin request plumbing on top of it.
  async onUploadCreate(req: Request, upload: { metadata?: Record<string, string | null> }) {
    const authorization = req.headers.get('authorization');
    const token = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : null;

    if (!token) {
      throw new UploadHttpError(401, 'El permiso de subida venció, volvé a intentar');
    }

    const movieId = Number(upload.metadata?.movieId);

    try {
      await this.uploadTickets.verifyAndSpend(token, movieId);
    } catch (err) {
      if (err instanceof Error && err.message === 'Upload ticket does not match the movie being uploaded') {
        throw new UploadHttpError(403, 'El permiso de subida no corresponde a esta película');
      }
      throw new UploadHttpError(401, 'El permiso de subida venció, volvé a intentar');
    }

    return {};
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
      throw new UploadHttpError(400, 'Metadata de la subida incompleta (movieId/filename)');
    }

    const movie = await this.prisma.movie.findUnique({ where: { id: movieId } });
    if (!movie) throw new UploadHttpError(404, `La película ${movieId} no existe`);

    if (movie.mediaSourceId) {
      throw new UploadHttpError(
        409,
        'Esta película ya tiene una descarga en curso. Confirmá para reemplazarla.',
      );
    }

    // path_downloads se re-lee acá, no en el snapshot de boot (this.uploadsDir
    // es fijo, ver onModuleInit): así un cambio hecho en Settings mientras la
    // subida estaba en curso se refleja en la próxima que termine, sin
    // necesitar reiniciar el api.
    const config = await this.settings.getMap();
    const downloadsBase = await this.mediaRoots.resolveFromRoot('downloads', config.path_downloads ?? '.');

    // FileStore escribe los bytes planos como <uploadsDir>/<id> — un archivo,
    // no una carpeta. El destino no puede reusar ese mismo nombre (mkdir
    // pisaría el propio archivo que se está moviendo), así que las subidas ya
    // cerradas van a su propio namespace "imports/<id>/<filename>", mismo
    // criterio que qBittorrent (client.ts::add) de una carpeta por descarga.
    const destDir = join(downloadsBase, 'imports', upload.id);
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
