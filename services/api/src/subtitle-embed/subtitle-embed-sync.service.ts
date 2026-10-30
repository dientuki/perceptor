import { Injectable, Logger } from '@nestjs/common';
import { Prisma, SubtitleEmbed as SubtitleEmbedRow } from '@prisma/client';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { PrismaService } from '@/prisma/prisma.service';
import { SubtitleEmbedQueueService } from '@/queue/subtitle-embed-queue.service';
import { SubtitleSyncQueueService } from '@/queue/subtitle-sync-queue.service';
import {
  RejectionKey,
  SyncMeasurement,
  accept,
} from '@/subtitle-search/acceptance';
import { lastCueEndMs } from '@/subtitle-search/last-cue';
import { i18nError } from '@/i18n/i18n-error';
import { ERROR_KEYS } from '@/i18n/error-keys';
import { decodeSidecar } from './sidecar-text';
import { SubtitleEmbedSyncDetails } from './entities/subtitle-embed-sync-details.entity';

// Spec 113, REQ-4
export const REJECTION_TO_EMBED_KEY: Record<RejectionKey, string> = {
  'error.subtitleSearch.framerate_mismatch':
    ERROR_KEYS.SUBTITLE_EMBED_SYNC_FRAMERATE_MISMATCH,
  'error.subtitleSearch.offset_too_large':
    ERROR_KEYS.SUBTITLE_EMBED_SYNC_OFFSET_TOO_LARGE,
  'error.subtitleSearch.incomplete': ERROR_KEYS.SUBTITLE_EMBED_SYNC_INCOMPLETE,
  'error.subtitleSearch.low_score': ERROR_KEYS.SUBTITLE_EMBED_SYNC_LOW_SCORE,
};

type StoredMeasurement = SyncMeasurement;

type SyncTrack = {
  fileName: string;
  offsetMs: number;
  autoOffset?: boolean;
  measurement?: StoredMeasurement;
  [key: string]: unknown;
};

export type SyncReport = Omit<SyncMeasurement, 'lastCueEndMs'>;

// Spec 113, REQ-3 REQ-5
@Injectable()
export class SubtitleEmbedSyncService {
  private readonly logger = new Logger(SubtitleEmbedSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly syncQueue: SubtitleSyncQueueService,
    private readonly embedQueue: SubtitleEmbedQueueService,
  ) {}

  // Spec 113, REQ-3
  async enqueue(row: SubtitleEmbedRow): Promise<void> {
    const tracks = row.tracks as unknown as SyncTrack[];
    for (const [index, track] of tracks.entries()) {
      if (!track.autoOffset) continue;
      await this.syncQueue.addEmbedSync(
        { subtitleEmbedId: row.id, fileName: track.fileName },
        index,
      );
    }
  }

  // Spec 113, REQ-3
  async details(
    subtitleEmbedId: number,
    fileName: string,
  ): Promise<SubtitleEmbedSyncDetails> {
    const row = await this.prisma.subtitleEmbed.findUnique({
      where: { id: subtitleEmbedId },
    });
    const track = row
      ? (row.tracks as unknown as SyncTrack[]).find(
          (t) => t.fileName === fileName,
        )
      : undefined;
    if (!row || row.status !== 'SYNCING' || !track?.autoOffset) {
      throw i18nError.notFound(ERROR_KEYS.SUBTITLE_EMBED_SYNC_NOT_FOUND, {
        id: subtitleEmbedId,
      });
    }
    return {
      subtitleEmbedId,
      fileName,
      filePath: row.filePath,
      candidatePath: join(dirname(row.filePath), fileName),
    };
  }

  // Spec 113, REQ-4 REQ-5 NFR-2
  async completed(
    subtitleEmbedId: number,
    fileName: string,
    report: SyncReport,
  ): Promise<boolean> {
    const row = await this.prisma.subtitleEmbed.findUnique({
      where: { id: subtitleEmbedId },
    });
    if (!row) return false;
    if (row.status !== 'SYNCING') return true;
    const known = (row.tracks as unknown as SyncTrack[]).find(
      (t) => t.fileName === fileName && t.autoOffset,
    );
    if (!known || known.measurement) return true;

    const measurement: SyncMeasurement = {
      ...report,
      lastCueEndMs: await this.readLastCueEnd(
        join(dirname(row.filePath), fileName),
      ),
    };
    const rejection = accept(measurement);

    const flipped = await this.prisma.$transaction(
      async (tx) => {
        const current = await tx.subtitleEmbed.findUnique({
          where: { id: subtitleEmbedId },
        });
        if (!current || current.status !== 'SYNCING') return false;
        const tracks = current.tracks as unknown as SyncTrack[];
        const target = tracks.find((t) => t.fileName === fileName);
        if (!target?.autoOffset || target.measurement) return false;

        target.measurement = measurement;
        if (rejection === null) target.offsetMs = measurement.offsetMs;

        const allAccepted = tracks
          .filter((t) => t.autoOffset)
          .every((t) => t.measurement !== undefined);

        const data: Prisma.SubtitleEmbedUpdateManyMutationInput = {
          tracks: tracks as unknown as Prisma.InputJsonValue,
        };
        if (rejection !== null) {
          data.status = 'FAILED';
          data.errorKey = REJECTION_TO_EMBED_KEY[rejection];
          data.finishedAt = new Date();
        } else if (allAccepted) {
          data.status = 'QUEUED';
        }

        const claimed = await tx.subtitleEmbed.updateMany({
          where: { id: subtitleEmbedId, status: 'SYNCING' },
          data,
        });
        return claimed.count === 1 && data.status === 'QUEUED';
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if (flipped) await this.enqueueRemux(subtitleEmbedId);
    return true;
  }

  // Spec 113, REQ-5 NFR-2
  async failed(
    subtitleEmbedId: number,
    fileName: string,
    errorKey: string,
  ): Promise<boolean> {
    const row = await this.prisma.subtitleEmbed.findUnique({
      where: { id: subtitleEmbedId },
    });
    if (!row) return false;
    if (row.status !== 'SYNCING') return true;

    if (errorKey !== ERROR_KEYS.SUBTITLE_EMBED_SYNC_FAILED) {
      this.logger.warn(
        `Unknown subtitle embed sync error key "${errorKey}" for embed ${subtitleEmbedId} (${fileName}); storing sync_failed`,
      );
    }
    await this.prisma.subtitleEmbed.updateMany({
      where: { id: subtitleEmbedId, status: 'SYNCING' },
      data: {
        status: 'FAILED',
        errorKey: ERROR_KEYS.SUBTITLE_EMBED_SYNC_FAILED,
        finishedAt: new Date(),
      },
    });
    return true;
  }

  // Spec 113, REQ-5
  private async enqueueRemux(subtitleEmbedId: number): Promise<void> {
    try {
      await this.embedQueue.addEmbed({ subtitleEmbedId });
    } catch (error) {
      this.logger.error(
        `Could not queue the remux of subtitle embed ${subtitleEmbedId}: ${String(error)}`,
      );
      await this.prisma.subtitleEmbed.updateMany({
        where: { id: subtitleEmbedId, status: 'QUEUED' },
        data: {
          status: 'FAILED',
          errorKey: ERROR_KEYS.SUBTITLE_EMBED_SYNC_FAILED,
          finishedAt: new Date(),
        },
      });
    }
  }

  // Spec 113, REQ-4
  private async readLastCueEnd(path: string): Promise<number | null> {
    try {
      return lastCueEndMs(decodeSidecar(await readFile(path)));
    } catch {
      return null;
    }
  }
}
