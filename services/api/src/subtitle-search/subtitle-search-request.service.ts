import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { MediaCapabilitiesService } from '@/media/media-capabilities.service';
import { ERROR_KEYS } from '@/i18n/error-keys';
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

    const column =
      target.kind === 'movie'
        ? { movieId: target.id }
        : { episodeId: target.id };

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

  // Spec 103, REQ-3 REQ-5
  private async wantedLanguages(
    target: SubtitleSearchTarget,
  ): Promise<string[]> {
    const owners = await this.optedInOwners(target);
    const wanted = new Set<string>();

    for (const owner of owners) {
      const own =
        owner.titleLanguages.length > 0
          ? owner.titleLanguages
          : await this.userLanguages(owner.userId);
      for (const iso3 of own) wanted.add(iso3.toLowerCase());
    }

    return [...wanted];
  }

  private async optedInOwners(
    target: SubtitleSearchTarget,
  ): Promise<Array<{ userId: string; titleLanguages: string[] }>> {
    if (target.kind === 'movie') {
      const rows = await this.prisma.userMovie.findMany({
        where: {
          movieId: target.id,
          subtitleSearch: true,
          user: { subtitleSearch: true },
        },
        select: { userId: true },
      });
      return Promise.all(
        rows.map(async ({ userId }) => ({
          userId,
          titleLanguages: (
            await this.prisma.userMovieLanguage.findMany({
              where: { userId, movieId: target.id, kind: 'SUBTITLE' },
              include: { language: true },
            })
          ).map((row) => row.language.iso3),
        })),
      );
    }

    const episode = await this.prisma.episode.findUnique({
      where: { id: target.id },
      select: { season: { select: { showId: true } } },
    });
    if (!episode) return [];
    const showId = episode.season.showId;

    const rows = await this.prisma.userShow.findMany({
      where: { showId, subtitleSearch: true, user: { subtitleSearch: true } },
      select: { userId: true },
    });
    return Promise.all(
      rows.map(async ({ userId }) => ({
        userId,
        titleLanguages: (
          await this.prisma.userShowLanguage.findMany({
            where: { userId, showId, kind: 'SUBTITLE' },
            include: { language: true },
          })
        ).map((row) => row.language.iso3),
      })),
    );
  }

  private async userLanguages(userId: string): Promise<string[]> {
    const rows = await this.prisma.userLanguagePreference.findMany({
      where: { userId, kind: 'SUBTITLE' },
      include: { language: true },
    });
    return rows.map((row) => row.language.iso3);
  }
}
