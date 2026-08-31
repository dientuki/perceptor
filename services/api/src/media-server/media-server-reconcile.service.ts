import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { SettingsService } from '@/settings/settings.service';
import { MediaServerIndexService } from '@/media-server-index/media-server-index.service';
import { createMediaServerClient } from '@/clients/media-server/registry';
import {
  MediaServerClient,
  MEDIA_SERVER_NONE,
} from '@/clients/media-server/types';
import { MEDIA_TYPE } from '@/types/media';

// Reflects what a configured media server already holds onto a newly
// registered (or re-registered) title. NFR-1: neither method ever throws —
// a failure here must never turn a title that registered fine into a
// GraphQL error, so the whole body of both public methods is try/catch.
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

      // The `status: 'MISSING'` clause in `where` IS the never-downgrade
      // guard (REQ-15): it makes the promotion atomic against a concurrent
      // torrentCompleted, and it is why this is an updateMany rather than a
      // findUnique-then-update, which would read one status and write over
      // whatever it became a moment later. filePath is never written here.
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
      // Season 0 (specials) is not filtered out here (REQ-13) — it
      // reconciles like any other season, the same way hydrate() does not
      // filter it when fetching from TMDB.
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

  // Mirrors MediaServerService.notifyCreated's early returns: no client
  // configured, or a client chosen but with no host filled in, both mean
  // "there is nothing to reconcile against" rather than an error (REQ-20).
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
