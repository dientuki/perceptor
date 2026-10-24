import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { i18nError } from '@/i18n/i18n-error';
import { ERROR_KEYS } from '@/i18n/error-keys';

// Spec 101, REQ-16
export type EmbedTarget =
  { movieId: number } | { episodeId: number } | { seasonId: number };

const ACTIVE_EMBED_STATUSES = ['QUEUED', 'RUNNING'] as const;

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
  }

  private targetWhere(target: EmbedTarget) {
    if ('movieId' in target) return { movieId: target.movieId };
    if ('episodeId' in target) return { episodeId: target.episodeId };
    return { episode: { seasonId: target.seasonId } };
  }
}
