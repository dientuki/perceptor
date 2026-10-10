import { Injectable, Logger } from '@nestjs/common';

import { IndexerService } from '@/indexer/indexer.service';
import { RankingContextService } from '@/indexer/ranking-context.service';
import { MoviesService } from '@/movies/movies.service';
import { deriveTitleStatus } from '@/pipeline-status/pipeline-status';
import { PrismaService } from '@/prisma/prisma.service';
import { resolveOpenWindow } from './acquisition-window';
import { ScheduledTaskHandler } from '../scheduler.registry';

export const MAX_MOVIES_PER_RUN = 20;

export function buildMovieQuery(title: string, releaseDate: Date | null): string {
  const cleaned = title.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  return releaseDate ? `${cleaned} ${releaseDate.getUTCFullYear()}` : cleaned;
}

@Injectable()
export class AcquireMoviesTask implements ScheduledTaskHandler {
  private readonly logger = new Logger(AcquireMoviesTask.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly indexer: IndexerService,
    private readonly rankingContext: RankingContextService,
    private readonly movies: MoviesService,
  ) {}

  async run(): Promise<{ itemsProcessed: number }> {
    const now = new Date();

    const rows = await this.prisma.movie.findMany({
      where: {
        users: { some: {} },
        OR: [
          { theatricalReleaseDate: { not: null } },
          { digitalReleaseDate: { not: null } },
          { physicalReleaseDate: { not: null } },
        ],
      },
      include: { mediaSources: true, processJobs: true },
    });

    const missing = rows.filter(
      (movie) =>
        deriveTitleStatus({
          filePath: movie.filePath,
          mediaServerPresentAt: movie.mediaServerPresentAt,
          sources: movie.mediaSources,
          jobs: movie.processJobs,
        }) === 'MISSING',
    );

    const open: Array<{
      movie: (typeof missing)[number];
      openedAt: Date;
      minSourceRank: number | null;
      ranking: Awaited<ReturnType<RankingContextService['forMovieOwners']>>;
    }> = [];
    let failed = 0;
    let attached = 0;
    let skipped = 0;

    for (const movie of missing) {
      try {
        const ranking = await this.rankingContext.forMovieOwners(movie.id);
        const window = resolveOpenWindow(
          ranking.owners.map((owner) => ({
            theatrical: owner.acquireTheatrical,
            digital: owner.acquireDigital,
            physical: owner.acquirePhysical,
            allowCinemaReleases: owner.allowCinemaReleases,
          })),
          movie,
          now,
        );
        if (window) open.push({ movie, ...window, ranking });
      } catch (err) {
        failed += 1;
        this.logger.warn(
          `acquire_movies: movie ${movie.id} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const eligible = open
      .sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime())
      .slice(0, MAX_MOVIES_PER_RUN);

    for (const { movie, minSourceRank, ranking } of eligible) {
      try {
        const ownerId = ranking.owners[0]?.userId;
        if (!ownerId) {
          skipped += 1;
          continue;
        }

        const query = buildMovieQuery(movie.title, movie.releaseDate);
        const ranked = await this.indexer.searchRanked(query, {
          ...ranking.context,
          minSourceRank,
        });
        const best = ranked.find((row) => row.candidateRank === 1);
        if (!best) {
          skipped += 1;
          continue;
        }

        await this.movies.addTorrentToMovie(
          movie.id,
          {
            infoHash: best.infoHash,
            urls: best.items
              .map((item) => item.downloadUrl)
              .filter((url): url is string => typeof url === 'string' && url.length > 0),
            releaseTitle: best.title,
            force: false,
          },
          ownerId,
        );
        attached += 1;
      } catch (err) {
        failed += 1;
        this.logger.warn(
          `acquire_movies: movie ${movie.id} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (failed > 0 && attached === 0 && skipped === 0) {
      throw new Error(
        `acquire_movies: all ${failed} attempted movie(s) failed; ${attached} attached`,
      );
    }

    return { itemsProcessed: attached };
  }
}
