import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { ERROR_KEYS } from '@/i18n/error-keys';
import { i18nError } from '@/i18n/i18n-error';
import { accept, SyncMeasurement } from './acceptance';
import { deriveLanguages } from './derive-languages';
import {
  SubtitleSearch,
  SubtitleSearchStatus,
} from './entities/subtitle-search.entity';
import { SubtitleSyncDetails } from './entities/subtitle-sync-details.entity';
import { SubtitleSearchQueueService } from './subtitle-search-queue.service';

const WORKER_ERROR_KEYS: string[] = [
  ERROR_KEYS.SUBTITLE_SEARCH_SYNC_FAILED,
  ERROR_KEYS.SUBTITLE_SEARCH_INTERRUPTED,
];

// Spec 103, REQ-13 REQ-10
@Injectable()
export class SubtitleSearchService {
  private readonly logger = new Logger(SubtitleSearchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: SubtitleSearchQueueService,
  ) {}

  // Spec 103, REQ-13
  async latestForMovie(movieId: number): Promise<SubtitleSearch | null> {
    return this.latest({ movieId });
  }

  // Spec 103, REQ-13
  async latestForEpisode(episodeId: number): Promise<SubtitleSearch | null> {
    return this.latest({ episodeId });
  }

  private async latest(
    where: { movieId: number } | { episodeId: number },
  ): Promise<SubtitleSearch | null> {
    const row = await this.prisma.subtitleSearch.findFirst({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { attempts: true },
    });
    if (!row) return null;

    return {
      id: row.id,
      status: row.status as SubtitleSearchStatus,
      errorKey: row.status === 'FAILED' ? row.errorKey : null,
      languages: deriveLanguages(row, row.attempts),
      createdAt: row.createdAt,
      finishedAt: row.finishedAt,
    };
  }

  // Spec 103, REQ-10
  async details(id: number): Promise<SubtitleSyncDetails> {
    const attempt = await this.prisma.subtitleSearchAttempt.findUnique({
      where: { id },
      include: {
        search: {
          include: {
            movie: { select: { filePath: true } },
            episode: { select: { filePath: true } },
          },
        },
      },
    });
    const filePath =
      attempt?.search.movie?.filePath ?? attempt?.search.episode?.filePath;
    if (!attempt || !attempt.stagedPath || !filePath) {
      throw i18nError.notFound(ERROR_KEYS.SUBTITLE_SEARCH_SYNC_NOT_FOUND, {
        id,
      });
    }
    return { id, filePath, candidatePath: attempt.stagedPath };
  }

  // Spec 103, REQ-10
  async started(id: number): Promise<boolean> {
    const result = await this.prisma.subtitleSearchAttempt.updateMany({
      where: { id, status: 'QUEUED' },
      data: { status: 'RUNNING' },
    });
    return result.count === 1;
  }

  // Spec 103, REQ-10
  async completed(id: number, measurement: SyncMeasurement): Promise<boolean> {
    const row = await this.prisma.subtitleSearchAttempt.findUnique({
      where: { id },
    });
    if (!row) return false;
    if (row.status !== 'RUNNING') return true;

    const reasonKey = accept(measurement);
    const claimed = await this.prisma.subtitleSearchAttempt.updateMany({
      where: { id, status: 'RUNNING' },
      data: {
        status: reasonKey === null ? 'ACCEPTED' : 'REJECTED',
        offsetMs: measurement.offsetMs,
        framerateRatio: measurement.framerateRatio,
        reference: measurement.reference,
        score: measurement.score,
        reasonKey,
        finishedAt: new Date(),
      },
    });
    if (claimed.count === 1) await this.wake(row.searchId);
    return true;
  }

  // Spec 103, REQ-14
  async failed(id: number, errorKey: string): Promise<boolean> {
    const row = await this.prisma.subtitleSearchAttempt.findUnique({
      where: { id },
    });
    if (!row) return false;
    if (row.status !== 'QUEUED' && row.status !== 'RUNNING') return true;

    let key = errorKey;
    if (!WORKER_ERROR_KEYS.includes(errorKey)) {
      this.logger.warn(
        `Unknown subtitle sync error key "${errorKey}" for attempt ${id}; storing sync_failed`,
      );
      key = ERROR_KEYS.SUBTITLE_SEARCH_SYNC_FAILED;
    }

    const claimed = await this.prisma.subtitleSearchAttempt.updateMany({
      where: { id, status: { in: ['QUEUED', 'RUNNING'] } },
      data: { status: 'FAILED', reasonKey: key, finishedAt: new Date() },
    });
    if (claimed.count === 1) await this.wake(row.searchId);
    return true;
  }

  private async wake(searchId: number): Promise<void> {
    try {
      await this.queue.wake(searchId);
    } catch (error) {
      this.logger.warn(
        `Could not wake subtitle search ${searchId}: ${String(error)}`,
      );
    }
  }
}
