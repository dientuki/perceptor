import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { SettingsService } from '@/settings/settings.service';
import { MediaServerIndexService } from '@/media-server-index/media-server-index.service';
import { createMediaServerClient } from '@/clients/media-server/registry';
import {
  MediaServerClient,
  MEDIA_SERVER_NONE,
} from '@/clients/media-server/types';
import { MEDIA_TYPE } from '@/types/media';
import { RefreshMediaServerOutcome } from '@/media/entities/title-refresh.entity';

export interface SyncResult {
  outcome: RefreshMediaServerOutcome;
  promoted: number;
  demoted: number;
}

const NOT_IN_FLIGHT_SOURCE: Prisma.MediaSourceListRelationFilter = {
  none: { status: { notIn: ['ERROR', 'SCANNED'] } },
};

// The in-flight guard (069): a title with a live source or job is not the
// media server's to promote or demote. It lives inside the `where` of every
// write so it is atomic against a concurrent torrentCompleted.
const IN_FLIGHT_GUARD: {
  mediaSources: Prisma.MediaSourceListRelationFilter;
  processJobs: Prisma.ProcessJobListRelationFilter;
} = {
  mediaSources: NOT_IN_FLIGHT_SOURCE,
  processJobs: { none: { status: { in: ['WAITING', 'QUEUED', 'ENCODING'] } } },
};

const failed = (): SyncResult => ({
  outcome: RefreshMediaServerOutcome.FAILED,
  promoted: 0,
  demoted: 0,
});

// Spec 034, NFR-1
@Injectable()
export class MediaServerReconcileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly index: MediaServerIndexService,
  ) {}

  async reconcileMovie(movieId: number, tmdbId: number): Promise<void> {
    try {
      const client = await this.client();
      if (!client) return;

      const externalId = await client.findByTmdbId(MEDIA_TYPE.MOVIE, tmdbId);
      if (!externalId) return;

      // Spec 034, REQ-15
      await this.prisma.movie.updateMany({
        where: { id: movieId, status: 'MISSING' },
        data: { status: 'COMPLETED' },
      });
    } catch (err) {
      console.error(
        `[media-server-reconcile] falló reconciliando la película ${movieId}:`,
        err,
      );
    }
  }

  async reconcileShow(showId: number, tmdbId: number): Promise<void> {
    try {
      const client = await this.client();
      if (!client) return;

      const externalId = await client.findByTmdbId(MEDIA_TYPE.SHOW, tmdbId);
      if (!externalId) return;

      const presentEpisodes = await client.listPresentEpisodes(externalId);
      if (!presentEpisodes.length) return;

      const seasons = await this.prisma.season.findMany({
        where: { showId },
        include: { episodes: true },
      });
      // Spec 034, REQ-13
      const bySeasonNumber = new Map(
        seasons.map((season) => [season.seasonNumber, season]),
      );

      for (const ref of presentEpisodes) {
        const season = bySeasonNumber.get(ref.seasonNumber);
        if (!season) continue; // the server has a season this show does not — skip silently

        const episode = season.episodes.find(
          (e) => e.episodeNumber === ref.episodeNumber,
        );
        if (!episode) continue; // same, at episode granularity

        await this.prisma.episode.updateMany({
          where: { id: episode.id, status: 'MISSING' },
          data: { status: 'COMPLETED' },
        });
      }
    } catch (err) {
      console.error(
        `[media-server-reconcile] falló reconciliando la serie ${showId}:`,
        err,
      );
    }
  }

  // Bidirectional, counted sync (069). Never throws; every read that can fail
  // happens before the first write, so a failure is FAILED with zero writes.
  async syncMovie(movieId: number, tmdbId: number): Promise<SyncResult> {
    try {
      const resolved = await this.clientWithConfig();
      if (!resolved) return this.skipped();
      if (!(await this.indexUsable(resolved))) return failed();

      const externalId = await resolved.client.findByTmdbId(
        MEDIA_TYPE.MOVIE,
        tmdbId,
      );
      const present = !!externalId;
      const { count } = present
        ? await this.prisma.movie.updateMany({
            where: { id: movieId, status: 'MISSING', ...IN_FLIGHT_GUARD },
            data: { status: 'COMPLETED' },
          })
        : await this.prisma.movie.updateMany({
            where: { id: movieId, status: 'COMPLETED', ...IN_FLIGHT_GUARD },
            data: { status: 'MISSING', filePath: null },
          });
      return {
        outcome: RefreshMediaServerOutcome.DONE,
        promoted: present ? count : 0,
        demoted: present ? 0 : count,
      };
    } catch (err) {
      console.error(`[media-server-reconcile] sync failed for movie ${movieId}:`, err);
      return failed();
    }
  }

  async syncShow(showId: number, tmdbId: number): Promise<SyncResult> {
    try {
      const resolved = await this.clientWithConfig();
      if (!resolved) return this.skipped();
      if (!(await this.indexUsable(resolved))) return failed();

      const externalId = await resolved.client.findByTmdbId(
        MEDIA_TYPE.SHOW,
        tmdbId,
      );
      // Absent show: every episode is "not present". A present show whose
      // listing throws is FAILED (caught below); an empty list is an answer.
      const presentEpisodes = externalId
        ? await resolved.client.listPresentEpisodes(externalId)
        : [];
      const presentKeys = new Set(
        presentEpisodes.map((e) => `${e.seasonNumber}:${e.episodeNumber}`),
      );

      const seasons = await this.prisma.season.findMany({
        where: { showId },
        include: { episodes: true },
      });

      const now = new Date();
      const buckets = {
        present: { aired: [] as number[], unaired: [] as number[] },
        absent: { aired: [] as number[], unaired: [] as number[] },
      };
      for (const season of seasons) {
        for (const ep of season.episodes) {
          const side = presentKeys.has(`${season.seasonNumber}:${ep.episodeNumber}`)
            ? buckets.present
            : buckets.absent;
          const aired = !!ep.releaseDate && ep.releaseDate <= now;
          (aired ? side.aired : side.unaired).push(ep.id);
        }
      }

      const seasonGuard = {
        season: { mediaSources: NOT_IN_FLIGHT_SOURCE },
      };
      let promoted = 0;
      let demoted = 0;
      const write = async (
        ids: number[],
        aired: boolean,
        from: 'MISSING' | 'COMPLETED',
      ): Promise<number> => {
        if (!ids.length) return 0;
        const { count } = await this.prisma.episode.updateMany({
          where: {
            id: { in: ids },
            status: from,
            ...IN_FLIGHT_GUARD,
            // The 059 lift: an aired episode is in flight while its season
            // has a live pack.
            ...(aired ? seasonGuard : {}),
          },
          data:
            from === 'MISSING'
              ? { status: 'COMPLETED' }
              : { status: 'MISSING', filePath: null },
        });
        return count;
      };
      for (const aired of [true, false]) {
        promoted += await write(
          aired ? buckets.present.aired : buckets.present.unaired,
          aired,
          'MISSING',
        );
        demoted += await write(
          aired ? buckets.absent.aired : buckets.absent.unaired,
          aired,
          'COMPLETED',
        );
      }
      return { outcome: RefreshMediaServerOutcome.DONE, promoted, demoted };
    } catch (err) {
      console.error(`[media-server-reconcile] sync failed for show ${showId}:`, err);
      return failed();
    }
  }

  private skipped(): SyncResult {
    return { outcome: RefreshMediaServerOutcome.SKIPPED, promoted: 0, demoted: 0 };
  }

  // 'failed' means the index is stale or half-read: demoting against it would
  // mass-demote a healthy library.
  private async indexUsable(r: {
    clientId: string;
    config: { host: string; port: string; apiKey: string };
  }): Promise<boolean> {
    const state = await this.index.refreshAndWait(r.clientId, r.config);
    return state !== 'failed';
  }

  private async clientWithConfig() {
    const map = await this.settings.getMap();
    const clientId = map.media_server_client;
    const client = await this.client();
    if (!client) return null;
    return {
      client,
      clientId,
      config: {
        host: map.media_server_host,
        port: map.media_server_port,
        apiKey: map.media_server_api_key,
      },
    };
  }

  // Spec 034, REQ-20
  private async client(): Promise<MediaServerClient | null> {
    const config = await this.settings.getMap();
    const clientId = config.media_server_client;

    if (
      !clientId ||
      clientId === MEDIA_SERVER_NONE ||
      !config.media_server_host
    )
      return null;

    return createMediaServerClient(
      clientId,
      {
        host: config.media_server_host,
        port: config.media_server_port,
        apiKey: config.media_server_api_key,
      },
      { lookup: (mediaType, tmdbId) => this.index.lookup(mediaType, tmdbId) },
    );
  }
}
