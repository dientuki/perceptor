import { Injectable } from '@nestjs/common';
import { MediaStatus } from '@prisma/client';
import { i18nError } from '@/i18n/i18n-error';
import { ERROR_KEYS } from '@/i18n/error-keys';
import { PrismaService } from '@/prisma/prisma.service';
import { RedisService } from '@/redis/redis.service';
import { MediaSearchResult, ShowDetail } from '@/clients/types';
import { MediaSearchResult as MediaSearchResultEntity } from '@/media/entities/media-search-result.entity';
import { TmdbClient, posterUrl } from '@/clients/tmdb/client';
import { TmdbShow } from '@/clients/tmdb/types';
import { MEDIA_TYPE } from '@/types/media';
import { MediaTypeService } from '@/media/media-type.interface';
import { MediaRef } from '@/media/entities/media-ref.entity';
import { MediaServerReconcileService } from '@/media-server/media-server-reconcile.service';
import { CalendarEpisodeRow } from '@/calendar/group-episodes';
import { ContentKind } from '@/media/entities/content-kind.enum';
import { classifyContentKind } from '@/media/content-kind';
import { DownloadsService } from '@/downloads/downloads.service';
import { CatalogSearchService } from '@/media/catalog-search.service';
import {
  CatalogDescriptor,
  RegisteredCatalogRow,
} from '@/media/catalog-descriptor';
import { RefreshCatalogOutcome, TitleRefresh } from '@/media/entities/title-refresh.entity';

const TMDB_CACHE_TTL_SECONDS = 60 * 60 * 24;

// TTL of the hydration claim key — long enough to cover a slow N-season
// fetch, short enough that a crashed process doesn't wedge retries for long
// (the `finally` below deletes it on every exit path anyway; this TTL is
// only the backstop for the one exit path that skips `finally`: the process
// dying mid-hydrate).
const HYDRATE_CLAIM_TTL_SECONDS = 60 * 10;

// 057-content-kind-classification: TMDB genre id for "Animation" — a local
// copy of content-kind.ts's own private constant, needed here only to
// decide *whether* a keywords lookup is worth making before handing the
// facts to classifyContentKind (which re-checks it itself). MoviesService
// and ShowsService are deliberate structural twins (006-media-search § Out
// of Scope) that each hold their own copy of small gating constants like
// this one, exactly as SHORT_MAX_RUNTIME_MINUTES/isShortRuntime are
// movies-only.
const SHOW_ANIMATION_GENRE_ID = 16;

// Spec 006, T007
@Injectable()
export class ShowsService implements MediaTypeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly tmdb: TmdbClient,
    private readonly mediaServerReconcile: MediaServerReconcileService,
    private readonly downloadsService: DownloadsService,
    private readonly catalogSearch: CatalogSearchService,
  ) {}

  // The library belongs to the user: only returns series this userId has
  // registered, filtered through the user_shows join — the shows row itself is
  // shared between every user who registered the same series. One query, no
  // per-row ownership lookup. No include: seasons and episodes belong to the
  // detail page, not the listing.
  async findAll(userId: string) {
    return this.prisma.show.findMany({
      where: { users: { some: { userId } } },
      orderBy: { createdAt: 'desc' }, // Most recently added first
    });
  }

  // Spec 009, NFR-2; Spec 043, REQ-4
  async findOneFromDb(id: number, userId: string) {
    const show = await this.prisma.show.findFirst({
      where: { id, users: { some: { userId } } },
      include: {
        seasons: {
          orderBy: { seasonNumber: 'asc' },
          include: {
            mediaSources: { where: { status: { not: 'ERROR' } } },
            episodes: {
              orderBy: { episodeNumber: 'asc' },
              include: { mediaSources: true, processJobs: true },
            },
          },
        },
      },
    });
    if (!show) return show;

    return {
      ...show,
      seasons: this.deriveSeasonEpisodeStatuses(show.seasons),
    };
  }

  async findEpisodesReleasedBetween(
    userId: string,
    from: Date,
    toExclusive: Date,
  ): Promise<CalendarEpisodeRow[]> {
    const episodes = await this.prisma.episode.findMany({
      where: {
        releaseDate: { gte: from, lt: toExclusive },
        season: { show: { users: { some: { userId } } } },
      },
      include: {
        season: {
          include: {
            show: { select: { id: true, title: true } },
          },
        },
      },
    });
    // Spec 089, REQ-6
    return episodes.map((episode) => ({
      showId: episode.season.show.id,
      showTitle: episode.season.show.title,
      seasonNumber: episode.season.seasonNumber,
      episodeNumber: episode.episodeNumber,
      episodeTitle: episode.title,
      releaseDate: episode.releaseDate as Date,
      status: episode.status,
    }));
  }

  // Spec 059, T003; Spec 089, REQ-6
  private deriveSeasonEpisodeStatuses<
    TSeason extends {
      episodes: {
        status: MediaStatus;
      }[];
    },
  >(seasons: TSeason[]) {
    return seasons.map((season) => ({
      ...season,
      episodes: season.episodes.map((episode) => ({
        ...episode,
        status: episode.status,
      })),
    }));
  }

  async register(tmdbId: number, userId: string): Promise<MediaRef> {
    const existing = await this.prisma.show.findUnique({ where: { tmdbId } });
    if (existing) {
      await this.linkUserToShow(userId, existing.id);

      // Spec 006, REQ-14
      if (existing.seasonsSyncedAt === null) {
        void this.hydrate(existing.id, tmdbId);
      } else {
        // Spec 034, REQ-18
        void this.mediaServerReconcile.reconcileShow(existing.id, tmdbId);
      }

      return { id: existing.id, type: MEDIA_TYPE.SHOW };
    }

    const cached = await this.getCachedShow(tmdbId);
    const contentKind = await this.deriveContentKind(cached);

    const show = await this.prisma.show.create({
      data: {
        tmdbId: cached.id,
        title: cached.title,
        overview: cached.overview,
        posterUrl: cached.posterUrl ?? undefined,
        releaseDate: cached.releaseDate
          ? new Date(cached.releaseDate)
          : undefined,
        originalLanguage: cached.originalLanguage,
        contentKind,
      },
    });

    await this.linkUserToShow(userId, show.id);

    // Spec 006, REQ-13
    void this.hydrate(show.id, tmdbId);

    return { id: show.id, type: MEDIA_TYPE.SHOW };
  }

  private hydrateClaimKey(tmdbId: number): string {
    return `show:hydrate:${tmdbId}`;
  }

  // Upserts every season and episode of a series from an already-fetched
  // season list (one TMDB call per season). Takes the list rather than
  // fetching the show detail so a caller that already holds it can reuse
  // this. Does not touch seasonsSyncedAt or reconcile: that stays with the
  // caller, after the whole loop has succeeded.
  private async syncSeasonsAndEpisodes(
    showId: number,
    tmdbId: number,
    seasons: ShowDetail['seasons'],
  ): Promise<void> {
    // Spec 006, NFR-6; Spec 006, REQ-12
    for (const season of seasons) {
      const seasonRow = await this.prisma.season.upsert({
        where: {
          showId_seasonNumber: { showId, seasonNumber: season.seasonNumber },
        },
        update: {
          releaseDate: season.releaseDate
            ? new Date(season.releaseDate)
            : undefined,
        },
        create: {
          showId,
          seasonNumber: season.seasonNumber,
          releaseDate: season.releaseDate
            ? new Date(season.releaseDate)
            : undefined,
        },
      });

      const episodes = await this.tmdb.seasonDetails(
        tmdbId,
        season.seasonNumber,
      );

      for (const episode of episodes) {
        await this.prisma.episode.upsert({
          where: {
            seasonId_episodeNumber: {
              seasonId: seasonRow.id,
              episodeNumber: episode.episodeNumber,
            },
          },
          update: {
            title: episode.title,
            overview: episode.overview,
            releaseDate: episode.releaseDate
              ? new Date(episode.releaseDate)
              : undefined,
          },
          create: {
            seasonId: seasonRow.id,
            episodeNumber: episode.episodeNumber,
            title: episode.title,
            overview: episode.overview,
            releaseDate: episode.releaseDate
              ? new Date(episode.releaseDate)
              : undefined,
          },
        });
      }
    }
  }

  // Spec 006, REQ-13; Spec 006, NFR-4; Spec 006, REQ-14
  private async hydrate(showId: number, tmdbId: number): Promise<void> {
    const claimKey = this.hydrateClaimKey(tmdbId);

    // Spec 006, NFR-5
    const claimed = await this.redis.set(
      claimKey,
      '1',
      'EX',
      HYDRATE_CLAIM_TTL_SECONDS,
      'NX',
    );
    if (claimed !== 'OK') return;

    try {
      const detail = (await this.tmdb.details(
        MEDIA_TYPE.SHOW,
        tmdbId,
      )) as ShowDetail;

      await this.syncSeasonsAndEpisodes(showId, tmdbId, detail.seasons);

      // Spec 006, REQ-14
      await this.prisma.show.update({
        where: { id: showId },
        data: { seasonsSyncedAt: new Date(), tmdbStatus: detail.status },
      });

      // Spec 034, REQ-19
      await this.mediaServerReconcile.reconcileShow(showId, tmdbId);
    } catch (err) {
      console.error(
        `Error hydrating seasons/episodes for show tmdbId=${tmdbId}:`,
        err,
      );
    } finally {
      // Deletes the claim regardless of outcome, so a failure does not wedge
      // every future retry until HYDRATE_CLAIM_TTL_SECONDS expires.
      await this.redis.del(claimKey);
    }
  }

  private async syncCatalogFromTmdb(showId: number, tmdbId: number): Promise<void> {
    const detail = (await this.tmdb.details(MEDIA_TYPE.SHOW, tmdbId)) as ShowDetail;
    const releaseDate = detail.firstAirDate || null;
    await this.prisma.show.update({
      where: { id: showId },
      data: {
        title: detail.title,
        overview: detail.overview,
        posterUrl: posterUrl(detail.posterPath) ?? undefined,
        releaseDate: releaseDate ? new Date(releaseDate) : undefined,
        originalLanguage: detail.originalLanguage,
        tmdbStatus: detail.status,
      },
    });

    await this.syncSeasonsAndEpisodes(showId, tmdbId, detail.seasons);

    await this.prisma.show.update({
      where: { id: showId },
      data: { seasonsSyncedAt: new Date() },
    });

    await this.cacheShows([
      {
        id: detail.id,
        title: detail.title,
        releaseDate,
        posterUrl: posterUrl(detail.posterPath),
        originalLanguage: detail.originalLanguage,
        overview: detail.overview,
        type: MEDIA_TYPE.SHOW,
        genreIds: detail.genreIds,
      },
    ]);
  }

  async syncCatalogClaimed(showId: number, tmdbId: number): Promise<boolean> {
    const claimKey = this.hydrateClaimKey(tmdbId);
    const claimed = await this.redis.set(claimKey, '1', 'EX', HYDRATE_CLAIM_TTL_SECONDS, 'NX');
    if (claimed !== 'OK') return false;
    try {
      await this.syncCatalogFromTmdb(showId, tmdbId);
      return true;
    } finally {
      await this.redis.del(claimKey);
    }
  }

  // 069-title-refresh: re-reads the series from TMDB (row fields, plus any new
  // seasons/episodes; nothing is ever deleted or blanked) and re-syncs status
  // against the media server. Ownership is checked by the resolver. TMDB and
  // media-server failures are outcomes, never thrown; only a lost claim throws.
  async refresh(id: number): Promise<TitleRefresh> {
    const row = await this.prisma.show.findUnique({ where: { id } });
    if (!row) throw i18nError.notFound(ERROR_KEYS.SHOW_NOT_AVAILABLE);
    const tmdbId = row.tmdbId;

    // Same key hydrate() claims, so a refresh and a hydration never overlap.
    const claimKey = this.hydrateClaimKey(tmdbId);
    const claimed = await this.redis.set(claimKey, '1', 'EX', HYDRATE_CLAIM_TTL_SECONDS, 'NX');
    if (claimed !== 'OK') throw i18nError.conflict(ERROR_KEYS.MEDIA_REFRESH_IN_PROGRESS);

    try {
      let catalog = RefreshCatalogOutcome.DONE;
      try {
        await this.syncCatalogFromTmdb(id, tmdbId);
      } catch (err) {
        console.error(`Error refreshing catalog for show tmdbId=${tmdbId}:`, err);
        catalog = RefreshCatalogOutcome.FAILED;
      }

      const sync = await this.mediaServerReconcile.syncShow(id, tmdbId);
      return {
        catalog,
        mediaServer: sync.outcome,
        promoted: sync.promoted,
        demoted: sync.demoted,
      };
    } finally {
      await this.redis.del(claimKey);
    }
  }

  // 067-title-removal: how many OTHER users hold this series. Advisory for the
  // confirmation dialog and the same count remove() branches on.
  async otherOwnersFor(userId: string, showId: number): Promise<number> {
    return this.prisma.userShow.count({
      where: { showId, userId: { not: userId } },
    });
  }

  // Spec 067, NFR-2
  async remove(id: number, userId: string): Promise<{ deleted: boolean; remainingOwners: number }> {
    const show = await this.findOneFromDb(id, userId);
    if (!show) throw i18nError.notFound(ERROR_KEYS.SHOW_NOT_AVAILABLE);

    const others = await this.otherOwnersFor(userId, id);
    if (others > 0) {
      await this.prisma.userShow.delete({
        where: { userId_showId: { userId, showId: id } },
      });
      return { deleted: false, remainingOwners: others };
    }

    await this.downloadsService.unwindSourcesForTitle({ showId: id });
    await this.prisma.show.delete({ where: { id } });
    return { deleted: true, remainingOwners: 0 };
  }

  // Spec 039, REQ-9
  async findAudioMandatoryFor(userId: string, showId: number): Promise<boolean> {
    const row = await this.prisma.userShow.findUnique({
      where: { userId_showId: { userId, showId } },
    });
    return row?.audioMandatory ?? false;
  }

  // Single-column update on a row addressed by its full primary key — the
  // caller (shows.resolver.ts) already ran findOneFromDb's ownership check,
  // so this row is guaranteed to exist and `update` (not `upsert`) is safe.
  async setAudioMandatoryFor(
    userId: string,
    showId: number,
    mandatory: boolean,
  ): Promise<boolean> {
    await this.prisma.userShow.update({
      where: { userId_showId: { userId, showId } },
      data: { audioMandatory: mandatory },
    });
    return mandatory;
  }

  // Spec 057, REQ-9
  async setContentKind(id: number, contentKind: ContentKind) {
    const show = await this.prisma.show.update({
      where: { id },
      data: { contentKind },
      include: {
        seasons: {
          orderBy: { seasonNumber: 'asc' },
          include: {
            mediaSources: { where: { status: { not: 'ERROR' } } },
            episodes: {
              orderBy: { episodeNumber: 'asc' },
              include: { mediaSources: true, processJobs: true },
            },
          },
        },
      },
    });

    return {
      ...show,
      seasons: this.deriveSeasonEpisodeStatuses(show.seasons),
    };
  }

  private async linkUserToShow(userId: string, showId: number): Promise<void> {
    await this.prisma.userShow.upsert({
      where: { userId_showId: { userId, showId } },
      update: {},
      create: { userId, showId },
    });
  }

  private async getCachedShow(tmdbId: number): Promise<MediaSearchResult> {
    const raw = await this.redis.get(this.catalogSearch.cacheKey('show', tmdbId));
    if (raw) return JSON.parse(raw) as MediaSearchResult;

    const fetched = await this.fetchShowFromTMDB(tmdbId);
    // Spec 088, REQ-7
    void this.cacheShows([fetched]);
    return fetched;
  }

  // Falls back to the catalog itself when the Redis cache has expired, been
  // evicted, or never got written (the best-effort save in cacheShows() can
  // silently fail). This is not a second search path: it re-fetches the one
  // series addMedia asked for, via the same TmdbClient.details() the rest of
  // the client uses, and reuses posterUrl() so this path and search() can
  // never disagree on image size for the same series. Only a tmdbId the
  // catalog itself does not know about reaches the caller as an error.
  private async fetchShowFromTMDB(tmdbId: number): Promise<MediaSearchResult> {
    let detail: ShowDetail;
    try {
      detail = (await this.tmdb.details(MEDIA_TYPE.SHOW, tmdbId)) as ShowDetail;
    } catch {
      throw i18nError.notFound(ERROR_KEYS.SHOW_NOT_IN_CATALOG);
    }

    return {
      id: detail.id,
      title: detail.title,
      releaseDate: detail.firstAirDate || null,
      posterUrl: posterUrl(detail.posterPath),
      originalLanguage: detail.originalLanguage,
      overview: detail.overview,
      type: MEDIA_TYPE.SHOW,
      // Spec 057, NFR-1
      genreIds: detail.genreIds,
    };
  }

  // Spec 057, REQ-6 NFR-1 NFR-2 REQ-5
  private async deriveContentKind(
    cached: MediaSearchResult,
  ): Promise<ContentKind> {
    let genreIds = cached.genreIds;

    if (genreIds === undefined) {
      try {
        const detail = (await this.tmdb.details(
          MEDIA_TYPE.SHOW,
          cached.id,
        )) as ShowDetail;
        genreIds = detail.genreIds ?? [];
        // Best-effort, never awaited into the caller's path: a cache hit
        // whose stored entry predates genre data still lacks it, so this
        // tops the cached entry up rather than re-asking TMDB on every
        // registration inside the TTL. cacheShows() already logs and
        // swallows its own failures.
        void this.cacheShows([{ ...cached, genreIds }]);
      } catch {
        genreIds = undefined;
      }
    }

    const isAnimated = (genreIds ?? []).includes(SHOW_ANIMATION_GENRE_ID);
    if (!isAnimated) {
      return classifyContentKind({ genreIds, keywordIds: undefined });
    }

    let keywordIds = cached.keywordIds;
    if (keywordIds === undefined) {
      try {
        keywordIds = await this.tmdb.keywords(MEDIA_TYPE.SHOW, cached.id);
        void this.cacheShows([{ ...cached, genreIds, keywordIds }]);
      } catch {
        keywordIds = undefined;
      }
    }

    return classifyContentKind({ genreIds, keywordIds });
  }

  // Spec 088, REQ-6
  private buildCatalogDescriptor(): CatalogDescriptor<TmdbShow> {
    return {
      mediaType: MEDIA_TYPE.SHOW,
      tmdbSearchPath: 'tv',

      toSearchResult: (item: TmdbShow): MediaSearchResult => ({
        id: item.id,
        title: item.name,
        releaseDate: item.first_air_date || null,
        posterUrl: posterUrl(item.poster_path),
        originalLanguage: item.original_language,
        overview: item.overview,
        type: MEDIA_TYPE.SHOW,
        genreIds: item.genre_ids,
      }),

      findRegistered: async (
        prisma,
        tmdbIds,
        userId,
      ): Promise<RegisteredCatalogRow[]> => {
        const shows = await prisma.show.findMany({
          where: { tmdbId: { in: tmdbIds } },
          select: {
            id: true,
            tmdbId: true,
            users: { where: { userId }, select: { userId: true } },
          },
        });

        return shows.map((show) => ({
          id: show.id,
          tmdbId: show.tmdbId,
          inLibrary: show.users.length > 0,
          isShort: false,
        }));
      },
    };
  }

  async search(
    query: string,
    userId: string,
  ): Promise<MediaSearchResultEntity[]> {
    return this.catalogSearch.search(
      this.buildCatalogDescriptor(),
      query,
      userId,
    );
  }

  async cacheAndEnrich(
    results: MediaSearchResult[],
    userId: string,
  ): Promise<MediaSearchResultEntity[]> {
    return this.catalogSearch.cacheAndEnrich(
      this.buildCatalogDescriptor(),
      results,
      userId,
    );
  }

  private async cacheShows(results: MediaSearchResult[]): Promise<void> {
    if (!results.length) return;

    try {
      const pipeline = this.redis.pipeline();

      for (const show of results) {
        pipeline.set(
          this.catalogSearch.cacheKey('show', show.id),
          JSON.stringify(show),
          'EX',
          TMDB_CACHE_TTL_SECONDS,
        );
      }

      const execResults = await pipeline.exec();

      const failed = (execResults ?? []).filter(([err]) => err);
      if (failed.length) {
        console.error(
          `Error caching ${failed.length} TMDB show(s) in Redis:`,
          failed.map(([err]) => err?.message),
        );
      }
    } catch (err) {
      console.error('Error caching TMDB results in Redis:', err);
    }
  }
}
