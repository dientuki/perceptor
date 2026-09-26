import { Injectable } from '@nestjs/common';

import { ScheduledTaskHandler } from '../scheduler.registry';
import { PrismaService } from '@/prisma/prisma.service';
import { MoviesService } from '@/movies/movies.service';
import { RefreshCatalogOutcome } from '@/media/entities/title-refresh.entity';
import { MediaStatus } from '@prisma/client';

@Injectable()
export class RefreshMoviesTask implements ScheduledTaskHandler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly movies: MoviesService,
  ) {}

  async run(): Promise<{ itemsProcessed: number }> {
    const pending = await this.prisma.movie.findMany({
      where: { status: { not: MediaStatus.COMPLETED }, catalogClosedAt: null },
      select: { id: true, tmdbId: true },
    });

    if (pending.length === 0) {
      return { itemsProcessed: 0 };
    }

    let succeeded = 0;
    let failed = 0;

    for (const movie of pending) {
      try {
        const outcome = await this.movies.refreshCatalog(movie.id, movie.tmdbId);
        if (outcome === RefreshCatalogOutcome.FAILED) {
          failed += 1;
        } else {
          succeeded += 1;
        }
      } catch {
        failed += 1;
      }
    }

    if (failed > 0) {
      throw new Error(
        `refresh_movies: ${failed} of ${pending.length} film(s) failed; ${succeeded} refreshed successfully`,
      );
    }

    return { itemsProcessed: succeeded };
  }
}
