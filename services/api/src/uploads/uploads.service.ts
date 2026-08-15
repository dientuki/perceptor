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
import type { UploadTicketTarget } from './upload-tickets.service';

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
  //
  // 010-episode-acquisition (T006): reads whichever id the metadata carries.
  // Exactly one of movieId/episodeId is expected — createUploadTicket only
  // ever mints a ticket for one target, so metadata carrying both or neither
  // means the browser sent something a legitimate ticket flow never produces;
  // verifyAndSpend below rejects it the same way a mismatched target does.
  async onUploadCreate(req: Request, upload: { metadata?: Record<string, string | null> }) {
    const authorization = req.headers.get('authorization');
    const token = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : null;

    if (!token) {
      throw new UploadHttpError(401, 'El permiso de subida venció, volvé a intentar');
    }

    const rawMovieId = upload.metadata?.movieId;
    const rawEpisodeId = upload.metadata?.episodeId;
    const isEpisode = rawEpisodeId !== undefined && rawEpisodeId !== null && rawEpisodeId !== '';

    const target: UploadTicketTarget = isEpisode
      ? { episodeId: Number(rawEpisodeId) }
      : { movieId: Number(rawMovieId) };

    try {
      await this.uploadTickets.verifyAndSpend(token, target);
    } catch (err) {
      const mismatch =
        err instanceof Error &&
        (err.message === 'Upload ticket does not match the movie being uploaded' ||
          err.message === 'Upload ticket does not match the episode being uploaded');
      if (mismatch) {
        throw new UploadHttpError(
          403,
          isEpisode
            ? 'El permiso de subida no corresponde a este episodio'
            : 'El permiso de subida no corresponde a esta película',
        );
      }
      throw new UploadHttpError(401, 'El permiso de subida venció, volvé a intentar');
    }

    return {};
  }

  // 010-episode-acquisition (T006): branches on whichever id the metadata
  // carries. The `movieId` metadata key keeps its name and meaning (NFR-1);
  // `episodeId` sits beside it. Both branches validate everything that can
  // throw — missing metadata, missing parent row, an already-active source —
  // before the file is moved off tus's staging directory, mirroring the film
  // path's existing ordering.
  private async handleUploadFinish(upload: {
    id: string;
    metadata?: Record<string, string | null>;
    storage?: { path: string };
  }) {
    const rawMovieId = upload.metadata?.movieId;
    const rawEpisodeId = upload.metadata?.episodeId;
    const isEpisode = rawEpisodeId !== undefined && rawEpisodeId !== null && rawEpisodeId !== '';

    const filename = sanitizeFilename(upload.metadata?.filename || upload.id);
    const rawPath = upload.storage?.path;

    if (isEpisode) {
      const episodeId = Number(rawEpisodeId);
      if (!episodeId || !rawPath) {
        throw new UploadHttpError(400, 'Metadata de la subida incompleta (episodeId/filename)');
      }

      const episode = await this.prisma.episode.findUnique({ where: { id: episodeId } });
      if (!episode) throw new UploadHttpError(404, `El episodio ${episodeId} no existe`);

      // Same active-source conflict rule as EpisodesService.attachTorrentSource
      // (010-episode-acquisition, T003): an episode is the pointed-at side of
      // MediaSource, so "already downloading" is a query for a non-ERROR
      // MediaSource against this episodeId, not a null-column check like a
      // film's Movie.mediaSourceId.
      const activeSource = await this.prisma.mediaSource.findFirst({
        where: { episodeId, status: { not: 'ERROR' } },
      });
      if (activeSource) {
        throw new UploadHttpError(
          409,
          'Este episodio ya tiene una descarga en curso. Confirmá para reemplazarla.',
        );
      }

      const destPath = await this.moveUploadedFile(upload.id, rawPath, filename);

      const mediaSource = await this.prisma.mediaSource.create({
        data: {
          kind: 'LOCAL_FILE',
          status: 'READY',
          downloadPath: destPath,
          releaseTitle: upload.metadata?.filename ?? null,
          episodeId,
        },
      });

      await this.prisma.episode.update({
        where: { id: episodeId },
        data: { status: 'ENCODING' },
      });

      await this.queue.addSourceReady({ mediaSourceId: mediaSource.id });

      console.log(`[uploads] ${upload.id}: completado -> mediaSource ${mediaSource.id} (episode ${episodeId}), encolado`);
      return;
    }

    const movieId = Number(rawMovieId);

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

    const destPath = await this.moveUploadedFile(upload.id, rawPath, filename);

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

  // Shared by both branches of handleUploadFinish: re-reads path_downloads
  // (not the boot-time snapshot in this.uploadsDir) and relocates the file
  // FileStore staged as a bare <uploadsDir>/<id> into its own
  // "imports/<id>/<filename>" namespace, the same criterion qBittorrent
  // (client.ts::add) uses for a folder per download.
  private async moveUploadedFile(uploadId: string, rawPath: string, filename: string): Promise<string> {
    const config = await this.settings.getMap();
    const downloadsBase = await this.mediaRoots.resolveFromRoot('downloads', config.path_downloads ?? '.');

    const destDir = join(downloadsBase, 'imports', uploadId);
    const destPath = join(destDir, filename);
    await mkdir(destDir, { recursive: true });
    await rename(rawPath, destPath);

    return destPath;
  }
}
