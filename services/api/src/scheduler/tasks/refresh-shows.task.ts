import { Injectable } from '@nestjs/common';

import { ScheduledTaskHandler } from '../scheduler.registry';
import { PrismaService } from '@/prisma/prisma.service';
import { ShowsService } from '@/shows/shows.service';

const ENDED_REFRESH_DAYS = 180;
const CONTINUING_REFRESH_DAYS = 30;
const ENDED_STATUSES = ['Ended', 'Canceled'];
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class RefreshShowsTask implements ScheduledTaskHandler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shows: ShowsService,
  ) {}

  async run(): Promise<{ itemsProcessed: number }> {
    const now = Date.now();
    const endedCutoff = new Date(now - ENDED_REFRESH_DAYS * DAY_MS);
    const continuingCutoff = new Date(now - CONTINUING_REFRESH_DAYS * DAY_MS);

    const due = await this.prisma.show.findMany({
      where: {
        OR: [
          { seasonsSyncedAt: null },
          { tmdbStatus: { in: ENDED_STATUSES }, seasonsSyncedAt: { lt: endedCutoff } },
          {
            OR: [{ tmdbStatus: null }, { tmdbStatus: { notIn: ENDED_STATUSES } }],
            seasonsSyncedAt: { lt: continuingCutoff },
          },
        ],
      },
      select: { id: true, tmdbId: true },
      orderBy: { seasonsSyncedAt: { sort: 'asc', nulls: 'first' } },
    });

    if (due.length === 0) {
      return { itemsProcessed: 0 };
    }

    let written = 0;
    let failed = 0;

    for (const show of due) {
      try {
        const synced = await this.shows.syncCatalogClaimed(show.id, show.tmdbId);
        if (synced) written += 1;
      } catch {
        failed += 1;
      }
    }

    if (failed > 0) {
      throw new Error(
        `refresh_shows: ${failed} of ${due.length} series failed; ${written} refreshed successfully`,
      );
    }

    return { itemsProcessed: written };
  }
}
