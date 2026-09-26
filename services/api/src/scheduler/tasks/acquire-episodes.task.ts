import { Injectable, Logger } from '@nestjs/common';

import { EpisodesService } from '@/episodes/episodes.service';
import { IndexerService } from '@/indexer/indexer.service';
import { RankingContextService } from '@/indexer/ranking-context.service';
import { RankingContext } from '@/indexer/ranking';
import { deriveEpisodeStatus } from '@/pipeline-status/pipeline-status';
import { PrismaService } from '@/prisma/prisma.service';
import { AUTO_ACQUIRE_EPISODES_SINCE_KEY, ScheduledTaskHandler } from '../scheduler.registry';

export const MAX_EPISODES_PER_RUN = 20;
const GRACE_DAYS = 1;

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function buildEpisodeQuery(
  showTitle: string,
  seasonNumber: number,
  episodeNumber: number,
): string {
  const title = showTitle.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${title} S${pad(seasonNumber)}E${pad(episodeNumber)}`;
}

interface SeriesContext {
  ranking: RankingContext;
  ownerId: string;
}

@Injectable()
export class AcquireEpisodesTask implements ScheduledTaskHandler {
  private readonly logger = new Logger(AcquireEpisodesTask.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly indexer: IndexerService,
    private readonly rankingContext: RankingContextService,
    private readonly episodes: EpisodesService,
  ) {}

  async run(): Promise<{ itemsProcessed: number }> {
    const now = new Date();
    const graceCutoff = startOfUtcDay(now);
    graceCutoff.setUTCDate(graceCutoff.getUTCDate() - GRACE_DAYS);

    const since = await this.readOrStampCutoff(now);

    const rows = await this.prisma.episode.findMany({
      where: {
        releaseDate: { not: null, lte: graceCutoff, gte: startOfUtcDay(since) },
        season: { seasonNumber: { not: 0 }, show: { users: { some: {} } } },
      },
      orderBy: { releaseDate: 'asc' },
      include: {
        mediaSources: true,
        processJobs: true,
        season: {
          include: {
            show: { select: { id: true, title: true } },
            mediaSources: { where: { status: { not: 'ERROR' } } },
          },
        },
      },
    });

    const eligible = rows
      .filter((episode) => deriveEpisodeStatus(episode.season.mediaSources, episode, now) === 'MISSING')
      .slice(0, MAX_EPISODES_PER_RUN);

    const series = new Map<number, SeriesContext>();
    let attached = 0;
    let skipped = 0;
    let failed = 0;

    for (const episode of eligible) {
      try {
        const show = episode.season.show;
        let context = series.get(show.id);
        if (!context) {
          const owner = await this.prisma.userShow.findFirst({
            where: { showId: show.id },
            orderBy: { createdAt: 'asc' },
            select: { userId: true },
          });
          if (!owner) {
            skipped += 1;
            continue;
          }
          context = {
            ranking: await this.rankingContext.forShowOwners(show.id),
            ownerId: owner.userId,
          };
          series.set(show.id, context);
        }

        const query = buildEpisodeQuery(
          show.title,
          episode.season.seasonNumber,
          episode.episodeNumber,
        );
        const ranked = await this.indexer.searchRanked(query, context.ranking);
        const best = ranked.find((row) => row.candidateRank === 1);
        if (!best) {
          skipped += 1;
          continue;
        }

        await this.episodes.addTorrentToEpisode(
          episode.id,
          {
            infoHash: best.infoHash,
            urls: best.items
              .map((item) => item.downloadUrl)
              .filter((url): url is string => typeof url === 'string' && url.length > 0),
            releaseTitle: best.title,
            force: false,
          },
          context.ownerId,
        );
        attached += 1;
      } catch (err) {
        failed += 1;
        this.logger.warn(
          `acquire_episodes: episode ${episode.id} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (failed > 0 && attached === 0 && skipped === 0) {
      throw new Error(
        `acquire_episodes: all ${failed} attempted episode(s) failed; ${attached} attached`,
      );
    }

    return { itemsProcessed: attached };
  }

  private async readOrStampCutoff(now: Date): Promise<Date> {
    const row = await this.prisma.setting.findUnique({
      where: { key: AUTO_ACQUIRE_EPISODES_SINCE_KEY },
    });
    const parsed = row?.value ? new Date(row.value) : null;
    if (parsed && !Number.isNaN(parsed.getTime())) return parsed;

    const value = now.toISOString();
    await this.prisma.setting.upsert({
      where: { key: AUTO_ACQUIRE_EPISODES_SINCE_KEY },
      update: { value },
      create: { key: AUTO_ACQUIRE_EPISODES_SINCE_KEY, value },
    });
    return now;
  }
}
