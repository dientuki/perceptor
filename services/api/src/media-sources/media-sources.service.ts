import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { SourceFileInput } from './dto/source-file.input';
import { ScannedMatchInput } from './dto/scanned-match.input';
import { EncodeQueueService } from '@/queue/encode-queue.service';
import { ERROR_KEYS } from '@/i18n/error-keys';
import { i18nError } from '@/i18n/i18n-error';
import { MESSAGES_EN } from '@/i18n/messages.en';
import { QbittorrentClient } from '@/clients/torrent/client';
import { TitleStatusService } from '@/title-status/title-status.service';

@Injectable()
export class MediaSourcesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encodeQueue: EncodeQueueService,
    private readonly torrentClient: QbittorrentClient,
    private readonly titleStatus: TitleStatusService,
  ) {}

  // Spec 052, NFR-1; Spec 052, REQ-2; Spec 052, REQ-4; Spec 052, REQ-8; Spec 052, REQ-7
  async downloadedFiles(source: { infoHash: string | null }): Promise<string[] | null> {
    if (!source.infoHash) return null;

    try {
      const files = await this.torrentClient.files(source.infoHash);
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

  // Spec 089, REQ-1 REQ-5
  private async markScanFailed(
    tx: Prisma.TransactionClient,
    mediaSource: { id: number },
    errorKey: string,
    errorParams: string | null,
    errorMessage: string,
    hasUnmatchedFiles?: boolean,
  ) {
    await tx.mediaSource.update({
      where: { id: mediaSource.id },
      data: { status: 'ERROR', errorMessage, errorKey, errorParams, hasUnmatchedFiles },
    });
  }

  async sourceScanFailed(
    mediaSourceId: number,
    errorKey: string,
    errorParams: string | null,
    errorMessage: string,
  ): Promise<boolean> {
    let recomputeTarget: { movieId: number | null; episodeId: number | null } | null = null;

    await this.prisma.$transaction(async (tx) => {
      const mediaSource = await tx.mediaSource.findUnique({
        where: { id: mediaSourceId },
        include: { movie: { select: { id: true } } },
      });
      if (!mediaSource || mediaSource.status !== 'READY') {
        console.log(`[sourceScanFailed] mediaSource ${mediaSourceId} is missing or not READY, ignoring`);
        return;
      }
      await this.markScanFailed(tx, mediaSource, errorKey, errorParams, errorMessage);
      recomputeTarget = { movieId: mediaSource.movie?.id ?? null, episodeId: mediaSource.episodeId };
    });

    // Spec 089, REQ-1 REQ-2
    if (recomputeTarget) {
      const target: { movieId: number | null; episodeId: number | null } = recomputeTarget;
      if (target.movieId) await this.titleStatus.recomputeMovie(target.movieId);
      if (target.episodeId) await this.titleStatus.recomputeEpisode(target.episodeId);
    }

    return true;
  }

  async sourceScanned(mediaSourceId: number, files: SourceFileInput[], matches: ScannedMatchInput[]) {
    const processJobIdsToQueue: number[] = [];
    let scanFailedTarget: { movieId: number | null; episodeId: number | null } | null = null;
    const episodeIdsToRecompute = new Set<number>();

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

      // Spec 013, NFR-7
      if (mediaSource.status === 'SCANNED') {
        console.log(`[sourceScanned] mediaSource ${mediaSourceId} ya estaba SCANNED, re-escaneando`);
      }

      if (!movieId && !mediaSource.episodeId && !mediaSource.season) {
        throw i18nError.badRequest(ERROR_KEYS.SOURCE_NO_TARGET, { id: mediaSourceId });
      }

      for (const match of matches) {
        const inFiles = files.some((file) => file.filePath === match.filePath);
        if (!inFiles) {
          throw i18nError.badRequest(ERROR_KEYS.SOURCE_MATCH_NOT_REPORTED, { filePath: match.filePath });
        }
      }

      // Spec 013, REQ-4
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

        // Spec 013, REQ-7
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

      // Spec 052, REQ-6
      const resolvedPaths = new Set(resolvedMatches.map((m) => m.filePath));
      const hasUnmatchedFiles = files.some(
        (file) => file.isVideo && file.isDownloaded && !resolvedPaths.has(file.filePath),
      );

      if (resolvedMatches.length === 0) {
        // Spec 052, REQ-7
        const errorKey = files.some((file) => file.isVideo && !file.isDownloaded)
          ? ERROR_KEYS.SOURCE_SCAN_NO_DOWNLOADED_VIDEO
          : ERROR_KEYS.SOURCE_SCAN_NO_VIDEO;
        const errorMessage = MESSAGES_EN[errorKey];

        await this.markScanFailed(tx, mediaSource, errorKey, null, errorMessage, hasUnmatchedFiles);
        scanFailedTarget = { movieId, episodeId: mediaSource.episodeId };

        return;
      }

      for (const resolved of resolvedMatches) {
        // Spec 013, REQ-5
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

        // Spec 013, NFR-7
        const existing = await tx.processJob.findUnique({
          where: { sourceFileId },
        });

        let jobCreatedOrRequeued = false;

        if (existing) {
          // Spec 013, NFR-7
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

        // Spec 013, REQ-6; Spec 089, REQ-2
        if (jobCreatedOrRequeued && resolved.episodeId) {
          episodeIdsToRecompute.add(resolved.episodeId);
        }
      }

      // Spec 013, NFR-7
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

    // Spec 089, REQ-1 REQ-2
    if (scanFailedTarget) {
      const target: { movieId: number | null; episodeId: number | null } = scanFailedTarget;
      if (target.movieId) await this.titleStatus.recomputeMovie(target.movieId);
      if (target.episodeId) await this.titleStatus.recomputeEpisode(target.episodeId);
    }
    for (const episodeId of episodeIdsToRecompute) {
      await this.titleStatus.recomputeEpisode(episodeId);
    }

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
