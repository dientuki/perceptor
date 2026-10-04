import { Injectable, OnModuleInit } from '@nestjs/common';
import { join, parse } from 'node:path';
import { access, mkdir, rename } from 'node:fs/promises';
import { Server } from '@tus/server';
import { FileStore } from '@tus/file-store';
import { PrismaService } from '@/prisma/prisma.service';
import { SettingsService } from '@/settings/settings.service';
import { MediaRootsService } from '@/media-roots/media-roots.service';
import { ProcessQueueService } from '@/queue/process-queue.service';
import { ERROR_KEYS, ErrorKey } from '@/i18n/error-keys';
import { MESSAGES_EN } from '@/i18n/messages.en';
import { UploadTicketExpiredError, UploadTicketMismatchError, UploadTicketsService } from './upload-tickets.service';
import type { UploadTicketTarget } from './upload-tickets.service';
import { DownloadsService } from '@/downloads/downloads.service';
import { SessionService } from './session.service';

const ILLEGAL_CHARS = /[<>:"/\\|?*\x00-\x1F]/g;

function sanitizeFilename(name: string): string {
  return name.replace(ILLEGAL_CHARS, '').trim() || 'video';
}

type UploadErrorParams = Record<string, string | number>;

// English rendering for a REST upload error, mirroring `i18n-error.ts`'s
// `renderMessage` (that one builds a Nest `HttpException` response, which
// this REST-only surface does not use). Kept local to `uploads/` rather than
// exported from `i18n-error.ts`, whose surface belongs to the GraphQL error
// path this task does not touch.
function renderUploadMessage(key: ErrorKey, params?: UploadErrorParams): string {
  const template = MESSAGES_EN[key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

// Spec 018, REQ-10
class UploadHttpError extends Error {
  status_code: number;
  body: string;

  constructor(status_code: number, key: ErrorKey, params?: UploadErrorParams) {
    const message = renderUploadMessage(key, params);
    super(message);
    this.status_code = status_code;
    this.body = JSON.stringify({
      message,
      i18n: params !== undefined ? { key, params } : { key },
    });
  }
}

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
    private readonly downloads: DownloadsService,
    private readonly sessions: SessionService,
  ) {}

  async onModuleInit() {
    const downloadsRoot = await this.mediaRoots.resolveFromRoot('downloads', '.');
    this.uploadsDir = join(downloadsRoot, 'uploads');

    this.server = new Server({
      path: '/uploads',
      datastore: new FileStore({ directory: this.uploadsDir }),
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

  // Spec 010, T006
  async onUploadCreate(req: Request, upload: { id: string; metadata?: Record<string, string | null> }) {
    const authorization = req.headers.get('authorization');
    const token = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : null;

    if (!token) {
      throw new UploadHttpError(401, ERROR_KEYS.UPLOAD_TICKET_EXPIRED);
    }

    const rawMovieId = upload.metadata?.movieId;
    const rawEpisodeId = upload.metadata?.episodeId;
    const rawMediaSourceId = upload.metadata?.mediaSourceId;
    const isEpisode = rawEpisodeId !== undefined && rawEpisodeId !== null && rawEpisodeId !== '';
    const isSession = rawMediaSourceId !== undefined && rawMediaSourceId !== null && rawMediaSourceId !== '';

    if (isSession) {
      const hasOtherTarget = isEpisode || (rawMovieId !== undefined && rawMovieId !== null && rawMovieId !== '');
      const mediaSourceId = Number(rawMediaSourceId);
      if (hasOtherTarget || !Number.isInteger(mediaSourceId) || mediaSourceId <= 0) {
        throw new UploadHttpError(400, ERROR_KEYS.UPLOAD_METADATA_INCOMPLETE);
      }
      try {
        const { userId } = await this.uploadTickets.verifyAndSpend(token, { mediaSourceId });
        await this.uploadTickets.markUploadOwner(upload.id, userId);
      } catch (err) {
        if (err instanceof UploadTicketMismatchError) {
          throw new UploadHttpError(403, ERROR_KEYS.UPLOAD_TICKET_WRONG_SOURCE);
        }
        if (err instanceof UploadTicketExpiredError) {
          throw new UploadHttpError(401, ERROR_KEYS.UPLOAD_TICKET_EXPIRED);
        }
        throw err;
      }
      return {};
    }

    const target: UploadTicketTarget = isEpisode
      ? { episodeId: Number(rawEpisodeId) }
      : { movieId: Number(rawMovieId) };

    let force = false;
    try {
      ({ force } = await this.uploadTickets.verifyAndSpend(token, target));
    } catch (err) {
      if (err instanceof UploadTicketMismatchError) {
        throw new UploadHttpError(
          403,
          err.target === 'episode' ? ERROR_KEYS.UPLOAD_TICKET_WRONG_EPISODE : ERROR_KEYS.UPLOAD_TICKET_WRONG_MOVIE,
        );
      }
      if (err instanceof UploadTicketExpiredError) {
        throw new UploadHttpError(401, ERROR_KEYS.UPLOAD_TICKET_EXPIRED);
      }
      throw err;
    }

    // Spec 027, REQ-7
    if (force) {
      await this.uploadTickets.markReplaceAuthorised(upload.id);
    }

    return {};
  }

  // Spec 010, T006; Spec 010, NFR-1
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

    const rawMediaSourceId = upload.metadata?.mediaSourceId;
    if (rawMediaSourceId !== undefined && rawMediaSourceId !== null && rawMediaSourceId !== '') {
      const mediaSourceId = Number(rawMediaSourceId);
      const hasOtherTarget = isEpisode || (rawMovieId !== undefined && rawMovieId !== null && rawMovieId !== '');
      if (hasOtherTarget || !Number.isInteger(mediaSourceId) || mediaSourceId <= 0 || !rawPath) {
        throw new UploadHttpError(400, ERROR_KEYS.UPLOAD_METADATA_INCOMPLETE);
      }

      const ownerId = await this.uploadTickets.getUploadOwner(upload.id);
      const session = ownerId ? await this.sessions.findOpenSeasonSession(mediaSourceId, ownerId) : null;
      if (!session || !session.downloadPath) throw new UploadHttpError(409, ERROR_KEYS.UPLOAD_SESSION_CLOSED);

      if (!(await this.mediaRoots.isInsideRoot('downloads', session.downloadPath))) {
        throw new UploadHttpError(409, ERROR_KEYS.UPLOAD_SESSION_CLOSED);
      }

      const destPath = await this.moveIntoSession(upload.id, rawPath, session.downloadPath, filename);
      console.log(`[uploads] ${upload.id}: completado -> sesión ${mediaSourceId} (${destPath})`);
      return;
    }

    if (isEpisode) {
      const episodeId = Number(rawEpisodeId);
      if (!episodeId || !rawPath) {
        throw new UploadHttpError(400, ERROR_KEYS.UPLOAD_METADATA_INCOMPLETE);
      }

      const episode = await this.prisma.episode.findUnique({ where: { id: episodeId } });
      if (!episode) throw new UploadHttpError(404, ERROR_KEYS.EPISODE_NOT_FOUND, { id: episodeId });

      // Spec 027, REQ-7; Spec 022, REQ-7; Spec 022, REQ-19
      if (episode.status === 'COMPLETED' && !(await this.uploadTickets.isReplaceAuthorised(upload.id))) {
        throw new UploadHttpError(409, ERROR_KEYS.EPISODE_ALREADY_COMPLETED);
      }

      const destPath = await this.moveUploadedFile(upload.id, rawPath, filename);

      // Spec 027, AC-7
      await this.demoteSupersededSources({ episodeId }, upload.id);

      const mediaSource = await this.prisma.mediaSource.create({
        data: {
          kind: 'LOCAL_FILE',
          status: 'READY',
          downloadPath: destPath,
          releaseTitle: upload.metadata?.filename ?? null,
          episodeId,
        },
      });

      // Spec 022, REQ-19; Spec 022, REQ-13
      const raceResult = await this.downloads.resolveRace(mediaSource.id);
      // resolveRace (read-only in this slice) answers with exactly one of two
      // prefixes; "not a winner" is checked as the absence of "ganador"
      // rather than by name-matching its other outcome.
      if (!raceResult.startsWith('ganador')) {
        // Spec 022, REQ-7
        throw new UploadHttpError(409, ERROR_KEYS.UPLOAD_SUPERSEDED);
      }

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
      throw new UploadHttpError(400, ERROR_KEYS.UPLOAD_METADATA_INCOMPLETE);
    }

    const movie = await this.prisma.movie.findUnique({ where: { id: movieId } });
    if (!movie) throw new UploadHttpError(404, ERROR_KEYS.MOVIE_NOT_FOUND, { id: movieId });

    // Spec 027, REQ-7; Spec 022, REQ-7; Spec 022, REQ-19
    if (movie.status === 'COMPLETED' && !(await this.uploadTickets.isReplaceAuthorised(upload.id))) {
      throw new UploadHttpError(409, ERROR_KEYS.MOVIE_ALREADY_COMPLETED);
    }

    const destPath = await this.moveUploadedFile(upload.id, rawPath, filename);

    // Same demotion as the episode branch above — see its comment.
    await this.demoteSupersededSources({ movieId }, upload.id);

    const mediaSource = await this.prisma.mediaSource.create({
      data: {
        kind: 'LOCAL_FILE',
        status: 'READY',
        downloadPath: destPath,
        releaseTitle: upload.metadata?.filename ?? null,
        movieId,
      },
    });

    // Spec 022, REQ-19 AC-22
    const raceResult = await this.downloads.resolveRace(mediaSource.id);
    if (!raceResult.startsWith('ganador')) {
      // Spec 022, REQ-7
      throw new UploadHttpError(409, ERROR_KEYS.UPLOAD_SUPERSEDED);
    }

    await this.prisma.movie.update({
      where: { id: movieId },
      data: { status: 'ENCODING' },
    });

    await this.queue.addSourceReady({ mediaSourceId: mediaSource.id });

    console.log(`[uploads] ${upload.id}: completado -> mediaSource ${mediaSource.id}, encolado`);
  }

  // Spec 038, REQ-6
  async demoteSupersededSources(
    target: { movieId: number } | { episodeId: number } | { seasonId: number },
    uploadId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const demoted = await tx.mediaSource.findMany({
        where: { ...target, status: { in: ['READY', 'SCANNED'] } },
        select: { id: true },
      });

      if (demoted.length === 0) return;

      const demotedIds = demoted.map((source) => source.id);

      await tx.mediaSource.updateMany({
        where: { id: { in: demotedIds } },
        data: {
          status: 'ERROR',
          errorMessage: MESSAGES_EN[ERROR_KEYS.SOURCE_REPLACED],
          errorKey: ERROR_KEYS.SOURCE_REPLACED,
          errorParams: null,
        },
      });

      // Spec 038, REQ-9
      const { count: jobsClosed } = await tx.processJob.updateMany({
        where: {
          sourceFile: { mediaSourceId: { in: demotedIds } },
          status: { in: ['WAITING', 'QUEUED', 'ENCODING'] },
        },
        data: {
          status: 'ERROR',
          errorKey: ERROR_KEYS.SOURCE_REPLACED,
          errorParams: null,
          errorMessage: MESSAGES_EN[ERROR_KEYS.SOURCE_REPLACED],
        },
      });

      console.log(
        `[uploads] ${uploadId}: ${demotedIds.length} source(s) anterior(es) marcada(s) ERROR por reemplazo, ${jobsClosed} processJob(s) cerrado(s)`,
      );
    });
  }

  // Session twin of moveUploadedFile: the folder already exists and belongs to
  // the session. A name already taken there keeps both files, the later one
  // carrying its tus upload id, and is never overwritten.
  private async moveIntoSession(
    uploadId: string,
    rawPath: string,
    sessionDir: string,
    filename: string,
  ): Promise<string> {
    let destPath = join(sessionDir, filename);
    const taken = await access(destPath).then(
      () => true,
      () => false,
    );
    if (taken) {
      const { name, ext } = parse(filename);
      destPath = join(sessionDir, `${name}.${uploadId}${ext}`);
    }
    await mkdir(sessionDir, { recursive: true });
    await rename(rawPath, destPath);

    return destPath;
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
