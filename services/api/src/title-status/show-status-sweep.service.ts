import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@/prisma/prisma.service';
import { TitleStatusService } from './title-status.service';

// Spec 089, REQ-12
@Injectable()
export class ShowStatusSweepService {
  private readonly logger = new Logger(ShowStatusSweepService.name);

  // Spec 089, REQ-12
  private static readonly LOOKBACK_HOURS = 2;

  constructor(
    private readonly prisma: PrismaService,
    private readonly titleStatus: TitleStatusService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async sweep(now: Date = new Date()): Promise<void> {
    const since = new Date(now.getTime() - ShowStatusSweepService.LOOKBACK_HOURS * 60 * 60 * 1000);

    const recentlyAired = await this.prisma.episode.findMany({
      where: { releaseDate: { gt: since, lte: now } },
      select: { season: { select: { showId: true } } },
    });

    const showIds = new Set(recentlyAired.map((episode) => episode.season.showId));

    for (const showId of showIds) {
      try {
        await this.titleStatus.recomputeShow(showId);
      } catch (err) {
        // Spec 089, NFR-4
        this.logger.error(`failed to recompute show ${showId} after an airing: ${String(err)}`);
      }
    }
  }
}
