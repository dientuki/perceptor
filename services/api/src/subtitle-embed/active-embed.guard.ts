import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { i18nError } from '@/i18n/i18n-error';
import { ERROR_KEYS } from '@/i18n/error-keys';

// Spec 101, REQ-16
export type EmbedTarget =
  { movieId: number } | { episodeId: number } | { seasonId: number };

// Spec 113, T002
export const ACTIVE_EMBED_STATUSES = ['SYNCING', 'QUEUED', 'RUNNING'] as const;

// Spec 101, REQ-16
@Injectable()
export class ActiveEmbedGuard {
  constructor(private readonly prisma: PrismaService) {}

  async hasActiveEmbed(target: EmbedTarget): Promise<boolean> {
    const count = await this.prisma.subtitleEmbed.count({
      where: {
        status: { in: [...ACTIVE_EMBED_STATUSES] },
        ...this.targetWhere(target),
      },
    });
    return count > 0;
  }

  async assertNoActiveEmbed(target: EmbedTarget): Promise<void> {
    if (await this.hasActiveEmbed(target)) {
      throw i18nError.conflict(ERROR_KEYS.SUBTITLE_EMBED_BUSY);
    }
    // Spec 123, REQ-17
    if (await this.hasClaimedTagItem(target)) {
      throw i18nError.conflict(ERROR_KEYS.LIBRARY_TAGS_BUSY);
    }
  }

  // Spec 123, REQ-17
  private async hasClaimedTagItem(target: EmbedTarget): Promise<boolean> {
    const where =
      'movieId' in target
        ? { movieId: target.movieId }
        : 'episodeId' in target
          ? { episodeId: target.episodeId }
          : { episode: { seasonId: target.seasonId } };
    const count = await this.prisma.libraryTagMigrationItem.count({
      where: { claimedAt: { not: null }, outcome: null, ...where },
    });
    return count > 0;
  }

  private targetWhere(target: EmbedTarget) {
    if ('movieId' in target) return { movieId: target.movieId };
    if ('episodeId' in target) return { episodeId: target.episodeId };
    return { episode: { seasonId: target.seasonId } };
  }
}
