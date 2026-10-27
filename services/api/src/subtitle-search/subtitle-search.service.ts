import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { ERROR_KEYS } from '@/i18n/error-keys';
import { i18nError } from '@/i18n/i18n-error';
import { readFile } from 'node:fs/promises';
import { accept, SyncMeasurement } from './acceptance';
import { lastCueEndMs } from './last-cue';
import { deriveLanguages } from './derive-languages';
import {
  SubtitleSearch,
  SubtitleSearchStatus,
} from './entities/subtitle-search.entity';
import { SubtitleProbeDetails } from './entities/subtitle-probe-details.entity';
import { resolveSidecarLanguages } from './sidecar-languages';
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
    // Spec 106, REQ-7
    const filePath =
      attempt?.search.movie?.filePath ??
      attempt?.search.episode?.filePath ??
      attempt?.search.libraryPath;
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
  async completed(
    id: number,
    report: Omit<SyncMeasurement, 'lastCueEndMs'>,
  ): Promise<boolean> {
    const row = await this.prisma.subtitleSearchAttempt.findUnique({
      where: { id },
    });
    if (!row) return false;
    if (row.status !== 'RUNNING') return true;

    const measurement: SyncMeasurement = {
      ...report,
      lastCueEndMs: await this.readLastCueEnd(row.stagedPath),
    };
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

  // Spec 103, REQ-10
  private async readLastCueEnd(stagedPath: string | null): Promise<number | null> {
    if (!stagedPath) return null;
    try {
      return lastCueEndMs(await readFile(stagedPath, 'utf8'));
    } catch {
      return null;
    }
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

  // Spec 107, T005
  async probeDetails(id: number): Promise<SubtitleProbeDetails> {
    const search = await this.prisma.subtitleSearch.findUnique({
      where: { id },
      include: {
        movie: { select: { filePath: true } },
        episode: { select: { filePath: true } },
      },
    });
    const filePath =
      search?.movie?.filePath ??
      search?.episode?.filePath ??
      search?.libraryPath;
    if (!search || search.status !== 'WAITING' || !filePath) {
      throw i18nError.notFound(ERROR_KEYS.SUBTITLE_SEARCH_PROBE_NOT_FOUND, {
        id,
      });
    }
    return { id, filePath };
  }

  // Spec 107, NFR-2
  async probeStarted(id: number): Promise<boolean> {
    const result = await this.prisma.subtitleSearch.updateMany({
      where: { id, status: 'WAITING', probeCount: { lt: 2 } },
      data: { probeCount: { increment: 1 } },
    });
    return result.count === 1;
  }

  // Spec 107, REQ-3
  async probeCompleted(
    id: number,
    report: {
      embeddedLanguagesIso3: string[];
      sidecarLanguageTags: string[];
      fileSizeBytes: number;
      movieHash: string;
    },
  ): Promise<boolean> {
    const row = await this.prisma.subtitleSearch.findUnique({ where: { id } });
    if (!row) return false;
    if (row.status !== 'WAITING') return row.movieHash !== null;

    const languages =
      report.sidecarLanguageTags.length > 0
        ? await this.prisma.language.findMany({
            select: { tag: true, iso2: true, iso3: true },
          })
        : [];
    const present = [
      ...new Set([
        ...report.embeddedLanguagesIso3.map((code) => code.toLowerCase()),
        ...resolveSidecarLanguages(report.sidecarLanguageTags, languages),
      ]),
    ];

    const claimed = await this.prisma.subtitleSearch.updateMany({
      where: { id, status: 'WAITING' },
      data: {
        status: 'SEARCHING',
        presentLanguages: present,
        fileSizeBytes: BigInt(Math.trunc(report.fileSizeBytes)),
        movieHash: report.movieHash,
      },
    });
    if (claimed.count === 1) await this.wake(id);
    return claimed.count === 1;
  }

  // Spec 107, T005
  async probeFailed(id: number, errorKey: string): Promise<boolean> {
    const row = await this.prisma.subtitleSearch.findUnique({ where: { id } });
    if (!row) return false;
    if (row.status !== 'WAITING') return true;

    let key = errorKey;
    if (errorKey !== ERROR_KEYS.SUBTITLE_SEARCH_PROBE_FAILED) {
      this.logger.warn(
        `Unknown subtitle probe error key "${errorKey}" for search ${id}; storing probe_failed`,
      );
      key = ERROR_KEYS.SUBTITLE_SEARCH_PROBE_FAILED;
    }

    await this.prisma.subtitleSearch.updateMany({
      where: { id, status: 'WAITING' },
      data: { status: 'FAILED', errorKey: key, finishedAt: new Date() },
    });
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
