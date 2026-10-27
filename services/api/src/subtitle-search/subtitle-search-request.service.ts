import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { MediaCapabilitiesService } from '@/media/media-capabilities.service';
import { ERROR_KEYS } from '@/i18n/error-keys';
import { i18nError } from '@/i18n/i18n-error';
import { SubtitleEmbedService } from '@/subtitle-embed/subtitle-embed.service';
import { SubtitleSearchQueueService } from './subtitle-search-queue.service';

export type SubtitleSearchTarget =
  { kind: 'movie'; id: number } | { kind: 'episode'; id: number };

const FIRST_WAKE_DELAY_MS = 5 * 60 * 1000;

const NON_TERMINAL = [
  'WAITING',
  'SEARCHING',
  'VALIDATING',
  'EMBEDDING',
] as const;

// Spec 103, REQ-3 REQ-4 REQ-5 REQ-12
@Injectable()
export class SubtitleSearchRequestService {
  private readonly logger = new Logger(SubtitleSearchRequestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly capabilities: MediaCapabilitiesService,
    private readonly queue: SubtitleSearchQueueService,
    private readonly embed: SubtitleEmbedService,
  ) {}

  async requestFor(target: SubtitleSearchTarget): Promise<void> {
    try {
      await this.request(target);
    } catch (error) {
      this.logger.warn(
        `Could not request a subtitle search for ${target.kind} ${target.id}: ${String(error)}`,
      );
    }
  }

  private async request(target: SubtitleSearchTarget): Promise<void> {
    if (!(await this.capabilities.isSubtitleSearchAvailable())) return;

    const wanted = await this.wantedLanguages(target);
    if (wanted.length === 0) return;

    const column = this.column(target);

    const created = await this.prisma.$transaction(async (tx) => {
      await tx.subtitleSearch.updateMany({
        where: { ...column, status: { in: [...NON_TERMINAL] } },
        data: {
          status: 'FAILED',
          errorKey: ERROR_KEYS.SUBTITLE_SEARCH_SUPERSEDED,
          finishedAt: new Date(),
        },
      });
      return tx.subtitleSearch.create({
        data: {
          ...column,
          status: 'WAITING',
          wantedLanguages: wanted,
          checkCount: 0,
        },
      });
    });

    try {
      await this.queue.wake(created.id, FIRST_WAKE_DELAY_MS);
    } catch (error) {
      this.logger.warn(
        `Could not schedule subtitle search ${created.id}; the boot re-wake recovers it: ${String(error)}`,
      );
    }
  }

  // Spec 106, REQ-3 REQ-4 REQ-5 REQ-8
  async requestForCaller(
    target: SubtitleSearchTarget,
    userId: string,
  ): Promise<number> {
    await this.embed.assertManualSearchPreflight(target, userId);

    const wanted = await this.wantedLanguages(target, userId);
    if (wanted.length === 0) {
      throw i18nError.badRequest(ERROR_KEYS.SUBTITLE_SEARCH_NO_LANGUAGES);
    }

    const created = await this.createGuarded(target, wanted);

    try {
      await this.queue.wake(created.id, 0);
    } catch (error) {
      this.logger.warn(
        `Could not schedule subtitle search ${created.id}; the boot re-wake recovers it: ${String(error)}`,
      );
    }
    return created.id;
  }

  // Spec 106, REQ-3 REQ-8
  private async createGuarded(target: SubtitleSearchTarget, wanted: string[]) {
    const column = this.column(target);
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const active = await tx.subtitleSearch.count({
            where: { ...column, status: { in: [...NON_TERMINAL] } },
          });
          if (active > 0) {
            throw i18nError.conflict(ERROR_KEYS.SUBTITLE_SEARCH_IN_PROGRESS);
          }
          return tx.subtitleSearch.create({
            data: {
              ...column,
              status: 'WAITING',
              wantedLanguages: wanted,
              checkCount: 0,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      ) {
        throw i18nError.conflict(ERROR_KEYS.SUBTITLE_SEARCH_IN_PROGRESS);
      }
      throw error;
    }
  }

  private column(target: SubtitleSearchTarget) {
    return target.kind === 'movie'
      ? { movieId: target.id }
      : { episodeId: target.id };
  }

  // Spec 103, REQ-3 REQ-5; Spec 106, REQ-4
  private async wantedLanguages(
    target: SubtitleSearchTarget,
    callerId?: string,
  ): Promise<string[]> {
    const showId = await this.showIdOf(target);
    const userIds = new Set<string>(
      showId === null && target.kind === 'episode'
        ? []
        : await this.optedInUserIds(target, showId),
    );
    if (callerId) userIds.add(callerId);

    const wanted = new Set<string>();
    for (const userId of userIds) {
      for (const iso3 of await this.effectiveLanguages(userId, target, showId)) {
        wanted.add(iso3.toLowerCase());
      }
    }
    return [...wanted];
  }

  private async showIdOf(target: SubtitleSearchTarget): Promise<number | null> {
    if (target.kind === 'movie') return null;
    const episode = await this.prisma.episode.findUnique({
      where: { id: target.id },
      select: { season: { select: { showId: true } } },
    });
    return episode ? episode.season.showId : null;
  }

  private async optedInUserIds(
    target: SubtitleSearchTarget,
    showId: number | null,
  ): Promise<string[]> {
    if (target.kind === 'movie') {
      const rows = await this.prisma.userMovie.findMany({
        where: { movieId: target.id, user: { subtitleSearch: true } },
        select: { userId: true },
      });
      return rows.map((row) => row.userId);
    }
    const rows = await this.prisma.userShow.findMany({
      where: { showId: showId!, user: { subtitleSearch: true } },
      select: { userId: true },
    });
    return rows.map((row) => row.userId);
  }

  private async effectiveLanguages(
    userId: string,
    target: SubtitleSearchTarget,
    showId: number | null,
  ): Promise<string[]> {
    const own =
      target.kind === 'movie'
        ? (
            await this.prisma.userMovieLanguage.findMany({
              where: { userId, movieId: target.id, kind: 'SUBTITLE' },
              include: { language: true },
            })
          ).map((row) => row.language.iso3)
        : showId === null
          ? []
          : (
              await this.prisma.userShowLanguage.findMany({
                where: { userId, showId, kind: 'SUBTITLE' },
                include: { language: true },
              })
            ).map((row) => row.language.iso3);
    return own.length > 0 ? own : this.userLanguages(userId);
  }

  private async userLanguages(userId: string): Promise<string[]> {
    const rows = await this.prisma.userLanguagePreference.findMany({
      where: { userId, kind: 'SUBTITLE' },
      include: { language: true },
    });
    return rows.map((row) => row.language.iso3);
  }
}
