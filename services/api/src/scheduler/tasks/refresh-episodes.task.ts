import { Injectable } from '@nestjs/common';

import { ScheduledTaskHandler } from '../scheduler.registry';
import { PrismaService } from '@/prisma/prisma.service';
import { TmdbClient } from '@/clients/tmdb/client';

// Two days of grace after air date, per spec.md REQ-2/REQ-3: TMDB routinely
// fills a title in at or just after air time, so an episode that aired
// yesterday is still worth re-fetching. A constant, not a Setting — REQ-3.
const GRACE_PERIOD_DAYS = 2;

interface SelectedEpisode {
  id: number;
  episodeNumber: number;
}

interface SeasonGroup {
  tmdbId: number;
  seasonNumber: number;
  episodes: SelectedEpisode[];
}

/**
 * `refresh_episodes` scheduled task. Sweeps every `Episode` row whose
 * catalog data is still in flight — not yet aired, or aired within the
 * grace window — groups them by the season they belong to, fetches each
 * distinct season from TMDB exactly once, and writes `title`, `overview`
 * and `releaseDate` back onto the rows it selected. See
 * docs/spec/features/041-episode-info-refresh/spec.md.
 */
@Injectable()
export class RefreshEpisodesTask implements ScheduledTaskHandler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tmdb: TmdbClient,
  ) {}

  async run(): Promise<{ itemsProcessed: number }> {
    const now = new Date();
    const cutoff = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    cutoff.setUTCDate(cutoff.getUTCDate() - GRACE_PERIOD_DAYS);

    const pending = await this.prisma.episode.findMany({
      where: {
        OR: [{ releaseDate: null }, { releaseDate: { gte: cutoff } }],
      },
      select: {
        id: true,
        episodeNumber: true,
        season: {
          select: {
            seasonNumber: true,
            show: { select: { tmdbId: true } },
          },
        },
      },
    });

    // Idle installation: zero TMDB calls (NFR-2, AC-4).
    if (pending.length === 0) {
      return { itemsProcessed: 0 };
    }

    // Group by (show.tmdbId, season.seasonNumber) so a season with several
    // selected episodes costs exactly one TMDB request (REQ-4).
    const groups = new Map<string, SeasonGroup>();
    for (const episode of pending) {
      const tmdbId = episode.season.show.tmdbId;
      const seasonNumber = episode.season.seasonNumber;
      const key = `${tmdbId}:${seasonNumber}`;

      let group = groups.get(key);
      if (!group) {
        group = { tmdbId, seasonNumber, episodes: [] };
        groups.set(key, group);
      }
      group.episodes.push({ id: episode.id, episodeNumber: episode.episodeNumber });
    }

    let written = 0;
    let failedGroups = 0;

    // Sequential, never Promise.all (NFR-1) — a burst against a shared TMDB
    // key rate-limits and leaves the sweep half-done with no error anywhere.
    for (const group of groups.values()) {
      try {
        const episodes = await this.tmdb.seasonDetails(
          group.tmdbId,
          group.seasonNumber,
        );
        const byNumber = new Map(
          episodes.map((episode) => [episode.episodeNumber, episode]),
        );

        for (const selected of group.episodes) {
          const found = byNumber.get(selected.episodeNumber);
          // Missing from TMDB's response: leave the row untouched and
          // uncounted (REQ-7) — never blank, never delete.
          if (!found) continue;

          await this.prisma.episode.update({
            where: { id: selected.id },
            data: {
              title: found.title,
              overview: found.overview,
              releaseDate: found.releaseDate ? new Date(found.releaseDate) : undefined,
            },
          });
          written += 1;
        }
      } catch {
        failedGroups += 1;
      }
    }

    if (failedGroups > 0) {
      throw new Error(
        `refresh_episodes: ${failedGroups} of ${groups.size} season(s) failed; ${written} episode(s) written successfully`,
      );
    }

    return { itemsProcessed: written };
  }
}
