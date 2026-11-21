import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { MediaServerService } from '@/media-server/media-server.service';
import { MediaRootsService } from '@/media-roots/media-roots.service';
import { notifyMediaServerModified } from '@/media-server/notify-modified';
import { LibraryLocationService } from '@/library-location/library-location.service';
import { LibraryTagsQueueService } from '@/queue/library-tags-queue.service';
import { ACTIVE_EMBED_STATUSES } from '@/subtitle-embed/active-embed.guard';
import { IN_FLIGHT_ENCODE_STATUSES } from '@/pipeline-status/pipeline-status';
import { provenanceOf } from '@/subtitle-search/provenance';
import { i18nError } from '@/i18n/i18n-error';
import { ERROR_KEYS } from '@/i18n/error-keys';
import { parseEncodeCommand } from './ffmpeg-command';
import {
  LibraryTagMigrationStatus,
  LibraryTagOutcome,
} from './entities/library-tag-enums';
import {
  LibraryTagMigration,
  LibraryTagMigrationItemDetails,
  LibraryTagMigrationTrack,
} from './entities/library-tag-migration.entity';

const USER_PROVENANCE = 'user';
const STAGED_PROVENANCE = 'opensubtitles';

const COUNTER = {
  MIGRATED: 'migrated',
  UNCHANGED: 'unchanged',
  BUSY: 'busy',
  MISSING: 'missing',
  FAILED: 'failed',
} as const;

const KNOWN_REASON_KEYS: string[] = [
  ERROR_KEYS.LIBRARY_TAGS_FILE_MISSING,
  ERROR_KEYS.LIBRARY_TAGS_WRITE_FAILED,
  ERROR_KEYS.LIBRARY_TAGS_VERIFY_FAILED,
];

type StoredTrack = {
  stagedPath?: string;
  provenance?: string;
};

// Spec 123, REQ-12 REQ-13 REQ-17 REQ-19
@Injectable()
export class LibraryTagsService {
  private readonly logger = new Logger(LibraryTagsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: LibraryTagsQueueService,
    private readonly location: LibraryLocationService,
    private readonly mediaServer: MediaServerService,
    private readonly mediaRoots: MediaRootsService,
  ) {}

  // Spec 123, REQ-18
  async latest(): Promise<LibraryTagMigration | null> {
    const run = await this.prisma.libraryTagMigration.findFirst({
      orderBy: { id: 'desc' },
    });
    if (!run) return null;
    const failed = await this.prisma.libraryTagMigrationItem.findMany({
      where: { migrationId: run.id, outcome: 'FAILED' },
      orderBy: { id: 'asc' },
      select: { hostPath: true, reasonKey: true },
    });
    return {
      id: run.id,
      status: run.status as LibraryTagMigrationStatus,
      total: run.total,
      processed: run.processed,
      migrated: run.migrated,
      unchanged: run.unchanged,
      busy: run.busy,
      missing: run.missing,
      failed: run.failed,
      failures: failed.map((item) => ({
        path: item.hostPath ?? '',
        reasonKey: item.reasonKey ?? ERROR_KEYS.LIBRARY_TAGS_WRITE_FAILED,
      })),
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
    };
  }

  // Spec 123, REQ-13 REQ-19
  async start(): Promise<LibraryTagMigration> {
    const running = await this.prisma.libraryTagMigration.count({
      where: { status: 'RUNNING' },
    });
    if (running > 0) {
      throw i18nError.conflict(ERROR_KEYS.LIBRARY_TAGS_MIGRATION_RUNNING);
    }

    const known = {
      OR: [{ filePath: { not: null } }, { mediaServerPresentAt: { not: null } }],
    };
    const [movies, episodes] = await Promise.all([
      this.prisma.movie.findMany({ where: known, select: { id: true } }),
      this.prisma.episode.findMany({ where: known, select: { id: true } }),
    ]);
    const total = movies.length + episodes.length;

    const run = await this.prisma.libraryTagMigration.create({
      data: {
        total,
        ...(total === 0
          ? { status: 'COMPLETED' as const, finishedAt: new Date() }
          : {}),
      },
    });

    if (total > 0) {
      await this.prisma.libraryTagMigrationItem.createMany({
        data: [
          ...movies.map((m) => ({ migrationId: run.id, movieId: m.id })),
          ...episodes.map((e) => ({ migrationId: run.id, episodeId: e.id })),
        ],
      });
      const items = await this.prisma.libraryTagMigrationItem.findMany({
        where: { migrationId: run.id },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      for (const item of items) await this.queue.enqueue(item.id);
    }

    return (await this.latest())!;
  }

  // Spec 123, REQ-14 REQ-15 REQ-17
  async claim(id: number): Promise<LibraryTagMigrationItemDetails> {
    const item = await this.prisma.libraryTagMigrationItem.findUnique({
      where: { id },
      include: {
        movie: { select: { id: true, tmdbId: true, filePath: true } },
        episode: {
          select: {
            id: true,
            episodeNumber: true,
            filePath: true,
            season: {
              select: { seasonNumber: true, show: { select: { tmdbId: true } } },
            },
          },
        },
      },
    });
    if (!item) throw i18nError.notFound(ERROR_KEYS.LIBRARY_TAGS_ITEM_NOT_FOUND);
    if (item.outcome !== null) {
      throw i18nError.conflict(ERROR_KEYS.LIBRARY_TAGS_ITEM_SETTLED);
    }

    const title = item.movieId
      ? { movieId: item.movieId }
      : { episodeId: item.episodeId! };

    if (await this.titleIsBusy(title)) {
      await this.settle(item.id, LibraryTagOutcome.BUSY, null, null);
      throw i18nError.conflict(ERROR_KEYS.LIBRARY_TAGS_ITEM_SETTLED);
    }

    const containerPath = await this.resolvePath(item);
    if (!containerPath) {
      await this.settle(
        item.id,
        LibraryTagOutcome.MISSING,
        ERROR_KEYS.LIBRARY_TAGS_FILE_MISSING,
        null,
      );
      throw i18nError.conflict(ERROR_KEYS.LIBRARY_TAGS_ITEM_SETTLED);
    }

    const hostPath = this.mediaRoots.containerToHostPath(
      'library',
      containerPath,
    );
    await this.prisma.libraryTagMigrationItem.updateMany({
      where: { id: item.id, outcome: null },
      data: { claimedAt: new Date(), hostPath },
    });

    return this.details(item.id, containerPath, title);
  }

  // Spec 123, REQ-18 NFR-6
  async finish(
    id: number,
    outcome: LibraryTagOutcome,
    reasonKey: string | null,
  ): Promise<boolean> {
    const item = await this.prisma.libraryTagMigrationItem.findUnique({
      where: { id },
    });
    if (!item) {
      this.logger.warn(`Report for unknown library tag item ${id} ignored`);
      return true;
    }
    if (item.outcome !== null) return true;

    if (reasonKey && !KNOWN_REASON_KEYS.includes(reasonKey)) {
      this.logger.warn(
        `Unknown library tag reasonKey "${reasonKey}" for item ${id}; stored as is`,
      );
    }

    const settled = await this.settle(
      id,
      outcome,
      outcome === LibraryTagOutcome.FAILED || outcome === LibraryTagOutcome.MISSING ? reasonKey : null,
      undefined,
    );

    if (settled && outcome === LibraryTagOutcome.MIGRATED) {
      const path = await this.currentContainerPath(item);
      if (path) {
        const ok = await notifyMediaServerModified(
          this.mediaServer,
          this.mediaRoots,
          this.logger,
          path,
        );
        if (!ok) {
          this.logger.warn(
            `Media server was not notified for migrated item ${id}`,
          );
        }
      }
    }
    return true;
  }

  // Spec 123, NFR-4
  async requeueAfterWorkerBoot(): Promise<void> {
    const runs = await this.prisma.libraryTagMigration.findMany({
      where: { status: 'RUNNING' },
      select: { id: true },
    });
    if (runs.length === 0) return;
    const where = {
      migrationId: { in: runs.map((run) => run.id) },
      outcome: null,
    };
    await this.prisma.libraryTagMigrationItem.updateMany({
      where,
      data: { claimedAt: null },
    });
    const items = await this.prisma.libraryTagMigrationItem.findMany({
      where,
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    for (const item of items) await this.queue.enqueue(item.id);
  }

  private async settle(
    id: number,
    outcome: LibraryTagOutcome,
    reasonKey: string | null,
    hostPath: string | null | undefined,
  ): Promise<boolean> {
    const claimed = await this.prisma.libraryTagMigrationItem.updateMany({
      where: { id, outcome: null },
      data: {
        outcome,
        reasonKey,
        settledAt: new Date(),
        ...(hostPath !== undefined ? { hostPath } : {}),
      },
    });
    if (claimed.count !== 1) return false;

    const item = await this.prisma.libraryTagMigrationItem.findUniqueOrThrow({
      where: { id },
      select: { migrationId: true },
    });
    await this.prisma.libraryTagMigration.update({
      where: { id: item.migrationId },
      data: {
        processed: { increment: 1 },
        [COUNTER[outcome]]: { increment: 1 },
      },
    });
    const left = await this.prisma.libraryTagMigrationItem.count({
      where: { migrationId: item.migrationId, outcome: null },
    });
    if (left === 0) {
      await this.prisma.libraryTagMigration.updateMany({
        where: { id: item.migrationId, status: 'RUNNING' },
        data: { status: 'COMPLETED', finishedAt: new Date() },
      });
    }
    return true;
  }

  private async titleIsBusy(
    title: { movieId: number } | { episodeId: number },
  ): Promise<boolean> {
    const [jobs, embeds, searches] = await Promise.all([
      this.prisma.processJob.count({
        where: { ...title, status: { in: IN_FLIGHT_ENCODE_STATUSES } },
      }),
      this.prisma.subtitleEmbed.count({
        where: { ...title, status: { in: [...ACTIVE_EMBED_STATUSES] } },
      }),
      this.prisma.subtitleSearch.count({
        where: {
          ...title,
          status: { in: ['SEARCHING', 'VALIDATING', 'EMBEDDING'] },
        },
      }),
    ]);
    return jobs + embeds + searches > 0;
  }

  private async resolvePath(item: {
    movie: { tmdbId: number; filePath: string | null } | null;
    episode: {
      episodeNumber: number;
      filePath: string | null;
      season: { seasonNumber: number; show: { tmdbId: number } };
    } | null;
  }): Promise<string | null> {
    const stored = item.movie?.filePath ?? item.episode?.filePath ?? null;
    if (stored) return stored;

    const located = item.movie
      ? await this.location.locate({ kind: 'movie', tmdbId: item.movie.tmdbId })
      : await this.location.locate({
          kind: 'episode',
          tmdbId: item.episode!.season.show.tmdbId,
          seasonNumber: item.episode!.season.seasonNumber,
          episodeNumber: item.episode!.episodeNumber,
        });
    if ('path' in located) return located.path;
    this.logger.warn(
      `Library file not resolvable for tag item (${located.reason}); settled MISSING`,
    );
    return null;
  }

  private async currentContainerPath(item: {
    movieId: number | null;
    episodeId: number | null;
    hostPath: string | null;
  }): Promise<string | null> {
    const row = item.movieId
      ? await this.prisma.movie.findUnique({
          where: { id: item.movieId },
          select: { filePath: true },
        })
      : await this.prisma.episode.findUnique({
          where: { id: item.episodeId! },
          select: { filePath: true },
        });
    if (row?.filePath) return row.filePath;
    return item.hostPath
      ? this.mediaRoots.hostToContainerPath('library', item.hostPath)
      : null;
  }

  // Spec 123, REQ-15
  private async details(
    id: number,
    filePath: string,
    title: { movieId: number } | { episodeId: number },
  ): Promise<LibraryTagMigrationItemDetails> {
    const job = await this.prisma.processJob.findFirst({
      where: { ...title, status: 'COMPLETED', outputFilePath: filePath },
      orderBy: { updatedAt: 'desc' },
      select: { ffmpegCommand: true, updatedAt: true },
    });
    const parsed = parseEncodeCommand(job?.ffmpegCommand);

    return {
      id,
      filePath,
      encodedAt: job?.updatedAt ?? null,
      videoCodec: parsed.videoCodec,
      crf: parsed.crf,
      preset: parsed.preset,
      contentKind: parsed.contentKind,
      resolutionCeiling: parsed.resolutionCeiling,
      outputResolution: null,
      grainApplied: parsed.grainApplied,
      deinterlaced: parsed.deinterlaced,
      dubTrimSeconds: null,
      streamEndTrimSeconds: null,
      tracks: await this.trackFacts(title),
    };
  }

  // Spec 123, REQ-15
  private async trackFacts(
    title: { movieId: number } | { episodeId: number },
  ): Promise<LibraryTagMigrationTrack[]> {
    const embeds = await this.prisma.subtitleEmbed.findMany({
      where: { ...title, status: 'COMPLETED' },
      orderBy: { finishedAt: 'desc' },
      select: { tracks: true, finishedAt: true },
    });
    const attempts = await this.prisma.subtitleSearchAttempt.findMany({
      where: { status: 'ACCEPTED', search: title as Prisma.SubtitleSearchWhereInput },
      orderBy: { id: 'desc' },
      select: {
        providerFileName: true,
        provider: true,
        providerSubtitleId: true,
        score: true,
        framerateRatio: true,
      },
    });

    const bySource = new Map<string, LibraryTagMigrationTrack>();
    for (const embed of embeds) {
      for (const track of (embed.tracks ?? []) as unknown as StoredTrack[]) {
        const stored =
          track.provenance ??
          (track.stagedPath == null ? USER_PROVENANCE : STAGED_PROVENANCE);
        const attempt =
          stored === USER_PROVENANCE
            ? undefined
            : attempts.find(
                (a) =>
                  bareProvenance(provenanceOf(a), a.provider) ===
                  bareProvenance(stored, a.provider),
              );
        // Spec 123, REQ-9
        const source = attempt ? bareProvenance(stored, attempt.provider) : stored;
        if (bySource.has(source)) continue;
        bySource.set(source, {
          source,
          provider:
            source === USER_PROVENANCE
              ? USER_PROVENANCE
              : attempt
                ? attempt.provider.toLowerCase()
                : null,
          syncScore: attempt?.score ?? null,
          framerateRatio: attempt?.framerateRatio ?? null,
          embeddedAt: embed.finishedAt,
        });
      }
    }
    return [...bySource.values()];
  }
}

// Spec 123, REQ-9
const bareProvenance = (value: string, provider: string | null): string => {
  if (!provider) return value;
  const prefix = `${provider.toLowerCase()}:`;
  return value.startsWith(prefix) && value.length > prefix.length
    ? value.slice(prefix.length)
    : value;
};
