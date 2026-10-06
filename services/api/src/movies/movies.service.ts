import { Injectable } from '@nestjs/common';
import { i18nError } from '@/i18n/i18n-error';
import { ERROR_KEYS } from '@/i18n/error-keys';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateMovieDto } from './dto/create-movie.dto';
import { UpdateMovieDto } from './dto/update-movie.dto';
import { RedisService } from '@/redis/redis.service';
import { MediaSearchResult, MovieDetail } from '@/clients/types';
import { MediaSearchResult as MediaSearchResultEntity } from '@/media/entities/media-search-result.entity';
import { TmdbClient, posterUrl } from '@/clients/tmdb/client';
import { TmdbMovie } from '@/clients/tmdb/types';
import { MEDIA_TYPE } from '@/types/media';
import { ContentKind as PrismaContentKind } from '@prisma/client';
import { isReleaseWindowClosed } from './release-window';
import { classifyContentKind } from '@/media/content-kind';
import { QbittorrentClient } from '@/clients/torrent/client';
import { parseMagnet } from '@/clients/torrent/magnet';
import { resolveInfoHash } from '@/clients/indexer/resolve-info-hash';
import { SourceKind } from '@prisma/client';
import { MediaTypeService } from '@/media/media-type.interface';
import { MediaRef } from '@/media/entities/media-ref.entity';
import { MediaServerReconcileService } from '@/media-server/media-server-reconcile.service';
import { deriveTitleStatus } from '@/pipeline-status/pipeline-status';
import { MediaCapabilitiesService } from '@/media/media-capabilities.service';
import { DownloadsService } from '@/downloads/downloads.service';
import {
  RefreshCatalogOutcome,
  TitleRefresh,
} from '@/media/entities/title-refresh.entity';

const TMDB_CACHE_TTL_SECONDS = 60 * 60 * 24;

// TTL of the refresh claim key; the `finally` in refresh() deletes it on
// every exit path, this only bounds a process dying mid-refresh.
const REFRESH_CLAIM_TTL_SECONDS = 60 * 2;

// Zero-padded "<Show> S04E01" rendering for a MediaSource owned by an
// episode, used only in the collision message below — matches the prefill
// format `SearchTorrent.tsx` builds on the web side. Kept local rather than
// shared with EpisodesService for the same reason attachTorrentSource itself
// is not shared (see 010-episode-acquisition's api/plan.md § Approach).
function episodeDisplayTitle(episode: {
  episodeNumber: number;
  season: { seasonNumber: number; show: { title: string } };
}): string {
  const season = String(episode.season.seasonNumber).padStart(2, '0');
  const ep = String(episode.episodeNumber).padStart(2, '0');
  return `${episode.season.show.title} S${season}E${ep}`;
}

// Spec 022, REQ-5
function sanitizeTag(title: string, fallbackId: number): string {
  const cleaned = title.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned || `id-${fallbackId}`;
}

// Spec 022, REQ-1
function movieTags(movie: { id: number; title: string }): string[] {
  return [sanitizeTag(movie.title, movie.id)];
}

// Spec 056, NFR-3
const SHORT_MAX_RUNTIME_MINUTES = 40;

// Spec 056, REQ-5
function isShortRuntime(runtime: number | null | undefined): boolean {
  return (
    typeof runtime === 'number' &&
    runtime > 0 &&
    runtime < SHORT_MAX_RUNTIME_MINUTES
  );
}

// Spec 057, REQ-2
const ANIMATION_GENRE_ID = 16;

@Injectable()
export class MoviesService implements MediaTypeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly tmdb: TmdbClient,
    private readonly qbittorrent: QbittorrentClient,
    private readonly mediaServerReconcile: MediaServerReconcileService,
    private readonly mediaCapabilities: MediaCapabilitiesService,
    private readonly downloadsService: DownloadsService,
  ) {}

  async create(createMovieDto: CreateMovieDto) {
    return this.prisma.movie.create({
      data: createMovieDto,
    });
  }

  // The library belongs to the user: only returns films this userId has
  // registered, filtered through the user_movies join. findOneFromDb() is
  // scoped the same way — movie(id) only resolves against the caller's own
  // library.
  async findAll(userId: string, isShort?: boolean) {
    const movies = await this.prisma.movie.findMany({
      where: {
        users: { some: { userId } },
        ...(isShort === undefined ? {} : { isShort }),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        mediaSources: true,
        processJobs: true,
      },
    });
    return movies.map((movie) => this.withDerivedStatus(movie));
  }

  async findReleasedBetween(userId: string, from: Date, toExclusive: Date) {
    const movies = await this.prisma.movie.findMany({
      where: {
        users: { some: { userId } },
        releaseDate: { gte: from, lt: toExclusive },
      },
      include: {
        mediaSources: true,
        processJobs: true,
      },
    });
    return movies.map((movie) => this.withDerivedStatus(movie));
  }

  // Same ownership clause as attachTorrentSource: returns the film only when
  // the caller is linked to it via user_movies. Returns null both when the
  // id does not exist and when it exists but belongs to someone else — the
  // two are deliberately indistinguishable from here on (see spec.md § Errors).
  async findOneFromDb(id: number, userId: string) {
    const movie = await this.prisma.movie.findFirst({
      where: { id, users: { some: { userId } } },
      include: {
        mediaSources: true,
        processJobs: true,
      },
    });
    return movie ? this.withDerivedStatus(movie) : null;
  }

  // Spec 043, REQ-4
  private withDerivedStatus<
    T extends {
      status: import('@prisma/client').MediaStatus;
      mediaSources: { status: import('@prisma/client').SourceStatus }[];
      processJobs: { status: import('@prisma/client').EncodeStatus }[];
    },
  >(movie: T): Omit<T, 'status'> & { status: string } {
    return {
      ...movie,
      status: deriveTitleStatus({
        status: movie.status,
        sources: movie.mediaSources,
        jobs: movie.processJobs,
      }),
    };
  }

  async update(id: number, updateMovieDto: UpdateMovieDto) {
    const existing = await this.prisma.movie.findUnique({ where: { id } });
    if (!existing) throw i18nError.notFound(ERROR_KEYS.MOVIE_NOT_FOUND, { id });

    return this.prisma.movie.update({
      where: { id },
      data: updateMovieDto,
    });
  }

  private cacheKey(tmdbId: number): string {
    return `tmdb:movie:${tmdbId}`;
  }

  // Spec 005, REQ-3
  async register(tmdbId: number, userId: string): Promise<MediaRef> {
    const existing = await this.prisma.movie.findUnique({ where: { tmdbId } });
    if (existing) {
      // Spec 048, REQ-6
      await this.linkUserToMovie(userId, existing.id);
      // Spec 034, NFR-3
      await this.mediaServerReconcile.reconcileMovie(existing.id, tmdbId);
      return { id: existing.id, type: MEDIA_TYPE.MOVIE };
    }

    const cached = await this.getCachedMovie(tmdbId);
    // 057-content-kind-classification: the single shared top-up — one
    // `tmdb.details()` call, at most, feeds both derivations below, so a
    // cold registration never pays for two (plan.md § Risks).
    const topped = await this.topUpCatalogFacts(cached);
    const isShort = await this.deriveIsShort(topped);
    const contentKind = await this.deriveContentKind(topped);

    const movie = await this.prisma.movie.create({
      data: {
        tmdbId: cached.id,
        title: cached.title,
        overview: cached.overview,
        posterUrl: cached.posterUrl ?? undefined,
        releaseDate:
          topped.earliestReleaseDate || cached.releaseDate
            ? new Date((topped.earliestReleaseDate || cached.releaseDate)!)
            : undefined,
        originalLanguage: cached.originalLanguage,
        // 075: typed days and TMDB status, only from what the top-up already
        // fetched; undefined leaves NULL for the sweep. Never catalogClosedAt.
        theatricalReleaseDate: topped.theatricalReleaseDate
          ? new Date(topped.theatricalReleaseDate)
          : undefined,
        digitalReleaseDate: topped.digitalReleaseDate
          ? new Date(topped.digitalReleaseDate)
          : undefined,
        physicalReleaseDate: topped.physicalReleaseDate
          ? new Date(topped.physicalReleaseDate)
          : undefined,
        tmdbStatus: topped.tmdbStatus || undefined,
        isShort,
        contentKind,
      },
    });

    await this.linkUserToMovie(userId, movie.id);
    await this.mediaServerReconcile.reconcileMovie(movie.id, tmdbId);
    return { id: movie.id, type: MEDIA_TYPE.MOVIE };
  }

  // Spec 039, REQ-9
  async findAudioMandatoryFor(userId: string, movieId: number): Promise<boolean> {
    const row = await this.prisma.userMovie.findUnique({
      where: { userId_movieId: { userId, movieId } },
    });
    return row?.audioMandatory ?? false;
  }

  // Single-column update on a row addressed by its full primary key — the
  // caller (movies.resolver.ts) already ran findOneFromDb's ownership check,
  // so this row is guaranteed to exist and `update` (not `upsert`) is safe.
  async setAudioMandatoryFor(
    userId: string,
    movieId: number,
    mandatory: boolean,
  ): Promise<boolean> {
    await this.prisma.userMovie.update({
      where: { userId_movieId: { userId, movieId } },
      data: { audioMandatory: mandatory },
    });
    return mandatory;
  }

  // 067-title-removal: how many OTHER users hold this film. Advisory for the
  // confirmation dialog and the same count remove() branches on.
  async otherOwnersFor(userId: string, movieId: number): Promise<number> {
    return this.prisma.userMovie.count({
      where: { movieId, userId: { not: userId } },
    });
  }

  // Spec 067, NFR-2; Spec 067, NFR-5
  async remove(id: number, userId: string): Promise<{ deleted: boolean; remainingOwners: number }> {
    const movie = await this.findOneFromDb(id, userId);
    if (!movie) throw i18nError.notFound(ERROR_KEYS.MOVIE_NOT_FOUND, { id });

    const others = await this.otherOwnersFor(userId, id);
    if (others > 0) {
      await this.prisma.userMovie.delete({
        where: { userId_movieId: { userId, movieId: id } },
      });
      return { deleted: false, remainingOwners: others };
    }

    await this.downloadsService.unwindSourcesForTitle({ movieId: id });
    await this.prisma.movie.delete({ where: { id } });
    return { deleted: true, remainingOwners: 0 };
  }

  // 069-title-refresh: re-reads the catalog facts from TMDB and re-checks the
  // media server for one owned film. Everything that can throw (ownership,
  // the claim) throws before any external call. A TMDB failure is reported as
  // catalog FAILED with the row untouched, never thrown. Only title, overview,
  // posterUrl, releaseDate and originalLanguage are written: isShort and
  // contentKind are user-correctable and never touched here.
  async refresh(id: number, userId: string): Promise<TitleRefresh> {
    const movie = await this.findOneFromDb(id, userId);
    if (!movie) throw i18nError.notFound(ERROR_KEYS.MOVIE_NOT_FOUND, { id });

    const claimKey = `movie:refresh:${movie.tmdbId}`;
    const claimed = await this.redis.set(
      claimKey,
      '1',
      'EX',
      REFRESH_CLAIM_TTL_SECONDS,
      'NX',
    );
    if (claimed !== 'OK') {
      throw i18nError.conflict(ERROR_KEYS.MEDIA_REFRESH_IN_PROGRESS);
    }

    try {
      const catalog = await this.refreshCatalog(id, movie.tmdbId);
      const sync = await this.mediaServerReconcile.syncMovie(id, movie.tmdbId);
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

  async refreshCatalog(
    id: number,
    tmdbId: number,
  ): Promise<RefreshCatalogOutcome> {
    try {
      const now = new Date();
      const detail = (await this.tmdb.details(
        MEDIA_TYPE.MOVIE,
        tmdbId,
      )) as MovieDetail;
      const windows = await this.tmdb.movieReleaseDates(tmdbId);
      const earliestReleaseDate = windows.earliest;
      const releaseDate = earliestReleaseDate || detail.releaseDate || null;

      const entry: MediaSearchResult = {
        id: detail.id,
        title: detail.title,
        releaseDate: detail.releaseDate || null,
        posterUrl: posterUrl(detail.posterPath),
        originalLanguage: detail.originalLanguage,
        overview: detail.overview,
        type: MEDIA_TYPE.MOVIE,
        runtime: detail.runtime ?? null,
        genreIds: detail.genreIds ?? [],
        earliestReleaseDate,
      };

      await this.prisma.movie.update({
        where: { id },
        data: {
          title: entry.title,
          overview: entry.overview,
          posterUrl: entry.posterUrl ?? undefined,
          releaseDate: releaseDate ? new Date(releaseDate) : undefined,
          originalLanguage: entry.originalLanguage,
          theatricalReleaseDate: windows.theatrical
            ? new Date(windows.theatrical)
            : undefined,
          digitalReleaseDate: windows.digital
            ? new Date(windows.digital)
            : undefined,
          physicalReleaseDate: windows.physical
            ? new Date(windows.physical)
            : undefined,
          tmdbStatus: detail.status || undefined,
          catalogClosedAt: isReleaseWindowClosed({
            earliestReleaseDate: earliestReleaseDate || null,
            theatricalReleaseDate: windows.theatrical,
            digitalReleaseDate: windows.digital,
            physicalReleaseDate: windows.physical,
            status: detail.status || null,
            now,
          })
            ? now
            : null,
        },
      });
      void this.cacheMovies([entry]);
      return RefreshCatalogOutcome.DONE;
    } catch (err) {
      console.error(`Catalog refresh failed for movie ${id}:`, err);
      return RefreshCatalogOutcome.FAILED;
    }
  }

  // Spec 048, REQ-6; Spec 048, REQ-1
  async setShort(id: number, userId: string, isShort: boolean) {
    const movie = await this.findOneFromDb(id, userId);
    if (!movie) throw i18nError.notFound(ERROR_KEYS.MOVIE_NOT_FOUND, { id });

    const updated = await this.prisma.movie.update({
      where: { id },
      data: { isShort },
      include: {
        mediaSources: true,
        processJobs: true,
      },
    });
    return this.withDerivedStatus(updated);
  }

  // Spec 057, REQ-8; Spec 057, REQ-1
  async setContentKind(id: number, userId: string, contentKind: PrismaContentKind) {
    const movie = await this.findOneFromDb(id, userId);
    if (!movie) throw i18nError.notFound(ERROR_KEYS.MOVIE_NOT_FOUND, { id });

    const updated = await this.prisma.movie.update({
      where: { id },
      data: { contentKind },
      include: {
        mediaSources: true,
        processJobs: true,
      },
    });
    return this.withDerivedStatus(updated);
  }

  // Spec 005, T004
  private async linkUserToMovie(
    userId: string,
    movieId: number,
  ): Promise<void> {
    await this.prisma.userMovie.upsert({
      where: { userId_movieId: { userId, movieId } },
      update: {},
      create: { userId, movieId },
    });
  }

  private async getCachedMovie(tmdbId: number): Promise<MediaSearchResult> {
    const raw = await this.redis.get(this.cacheKey(tmdbId));
    if (raw) return JSON.parse(raw) as MediaSearchResult;

    const fetched = await this.fetchMovieFromTMDB(tmdbId);
    // Spec 056, REQ-6
    void this.cacheMovies([fetched]);
    return fetched;
  }

  // Spec 005, REQ-2
  private async fetchMovieFromTMDB(tmdbId: number): Promise<MediaSearchResult> {
    let detail: MovieDetail;
    try {
      detail = (await this.tmdb.details(
        MEDIA_TYPE.MOVIE,
        tmdbId,
      )) as MovieDetail;
    } catch {
      throw i18nError.notFound(ERROR_KEYS.MOVIE_NOT_IN_CATALOG);
    }

    return {
      id: detail.id,
      title: detail.title,
      releaseDate: detail.releaseDate || null,
      posterUrl: posterUrl(detail.posterPath),
      originalLanguage: detail.originalLanguage,
      overview: detail.overview,
      type: MEDIA_TYPE.MOVIE,
      runtime: detail.runtime ?? null,
    };
  }

  // Spec 057, NFR-2
  private async topUpCatalogFacts(
    cached: MediaSearchResult,
  ): Promise<MediaSearchResult> {
    const needsDetails =
      typeof cached.runtime !== 'number' || !Array.isArray(cached.genreIds);
    const needsRelease = cached.earliestReleaseDate === undefined;
    if (!needsDetails && !needsRelease) return cached;

    let topped = cached;
    if (needsDetails) {
      try {
        const detail = (await this.tmdb.details(
          MEDIA_TYPE.MOVIE,
          cached.id,
        )) as MovieDetail;
        topped = {
          ...topped,
          runtime: detail.runtime ?? null,
          genreIds: detail.genreIds ?? [],
          tmdbStatus: detail.status || null,
        };
      } catch {
      }
    }
    if (needsRelease) {
      try {
        const windows = await this.tmdb.movieReleaseDates(cached.id);
        topped = {
          ...topped,
          earliestReleaseDate: windows.earliest,
          theatricalReleaseDate: windows.theatrical,
          digitalReleaseDate: windows.digital,
          physicalReleaseDate: windows.physical,
        };
      } catch {
      }
    }
    if (topped !== cached) void this.cacheMovies([topped]);
    return topped;
  }

  // Spec 056, REQ-4 REQ-7 REQ-8
  private async deriveIsShort(topped: MediaSearchResult): Promise<boolean> {
    if (!(await this.mediaCapabilities.isShortsEnabled())) return false;
    return isShortRuntime(topped.runtime);
  }

  // Spec 057, REQ-2 REQ-3 REQ-4 REQ-5 NFR-2
  private async deriveContentKind(
    topped: MediaSearchResult,
  ): Promise<PrismaContentKind> {
    try {
      const isAnimated = (topped.genreIds ?? []).includes(
        ANIMATION_GENRE_ID,
      );
      if (!isAnimated) {
        return classifyContentKind({
          genreIds: topped.genreIds,
          keywordIds: undefined,
        }) as unknown as PrismaContentKind;
      }

      let keywordIds = topped.keywordIds;
      if (keywordIds === undefined) {
        try {
          keywordIds = await this.tmdb.keywords(MEDIA_TYPE.MOVIE, topped.id);
          void this.cacheMovies([{ ...topped, keywordIds }]);
        } catch {
          return 'CGI' as PrismaContentKind;
        }
      }

      return classifyContentKind({
        genreIds: topped.genreIds,
        keywordIds,
      }) as unknown as PrismaContentKind;
    } catch {
      return 'LIVE_ACTION' as PrismaContentKind;
    }
  }

  async search(
    query: string,
    userId: string,
  ): Promise<MediaSearchResultEntity[]> {
    if (!query.trim()) return [];

    const items = await this.tmdb.search<TmdbMovie>('movie', query);

    const results: MediaSearchResult[] = items.map((item) => ({
      id: item.id,
      title: item.title,
      releaseDate: item.release_date || null,
      posterUrl: posterUrl(item.poster_path),
      originalLanguage: item.original_language,
      overview: item.overview,
      type: MEDIA_TYPE.MOVIE,
      genreIds: item.genre_ids,
    }));

    return this.cacheAndEnrich(results, userId);
  }

  // Steps 3-4 of the former search(): the cache write and the ownership
  // enrichment, in this order and only this order — see 026-multi-search's
  // MediaSearchService, the second caller of this method.
  async cacheAndEnrich(
    results: MediaSearchResult[],
    userId: string,
  ): Promise<MediaSearchResultEntity[]> {
    // Spec 005, NFR-5
    void this.cacheMovies(results);

    // Spec 005, NFR-5
    const enriched = await this.enrichWithOwnership(results, userId);

    return enriched;
  }

  // Attaches movieId (registered by anyone, or null) and inLibrary (owned by
  // this caller) to a page of catalog results, from a single query — not one
  // per result. Deliberately not merged into the objects passed to
  // cacheMovies(): see the ordering note in searchMovies().
  private async enrichWithOwnership(
    results: MediaSearchResult[],
    userId: string,
  ): Promise<MediaSearchResultEntity[]> {
    if (!results.length) return [];

    const movies = await this.prisma.movie.findMany({
      where: { tmdbId: { in: results.map((r) => r.id) } },
      select: {
        id: true,
        tmdbId: true,
        isShort: true,
        users: { where: { userId }, select: { userId: true } },
      },
    });

    const byTmdbId = new Map(movies.map((m) => [m.tmdbId, m]));

    return results.map((result) => {
      const registered = byTmdbId.get(result.id);
      return {
        ...result,
        mediaId: registered?.id ?? null,
        inLibrary: (registered?.users.length ?? 0) > 0,
        isShort: registered?.isShort ?? false,
      };
    });
  }

  async addTorrentToMovie(
    movieId: number,
    input: {
      infoHash: string | null;
      urls: string[];
      releaseTitle: string | null;
      force: boolean;
    },
    userId: string,
  ) {
    // The indexer no longer guarantees an infoHash at search time
    // (037-indexer-result-loss) — resolve it here, once, for the one
    // release the user chose, before anything reaches attachTorrentSource.
    const infoHash = input.infoHash ?? (await resolveInfoHash(input.urls));

    return this.attachTorrentSource(
      movieId,
      { kind: 'TORRENT_SEARCH', ...input, infoHash },
      userId,
    );
  }

  async addMagnetToMovie(
    movieId: number,
    input: { magnet: string; force: boolean },
    userId: string,
  ) {
    // Spec 018, T010
    const parsed = parseMagnet(input.magnet);

    return this.attachTorrentSource(
      movieId,
      {
        kind: 'TORRENT_FILE',
        infoHash: parsed.infoHash,
        urls: [input.magnet],
        releaseTitle: parsed.displayName,
        force: input.force,
      },
      userId,
    );
  }

  // Spec 005, REQ-6
  private async attachTorrentSource(
    movieId: number,
    input: {
      kind: SourceKind;
      infoHash: string;
      urls: string[];
      releaseTitle: string | null;
      force: boolean;
    },
    userId: string,
  ) {
    const movie = await this.prisma.movie.findFirst({
      where: { id: movieId, users: { some: { userId } } },
      include: { mediaSources: true, processJobs: true },
    });
    if (!movie)
      throw i18nError.notFound(ERROR_KEYS.MOVIE_NOT_FOUND, { id: movieId });

    const existingSource = await this.prisma.mediaSource.findUnique({
      where: { infoHash: input.infoHash },
      include: {
        movie: true,
        episode: { include: { season: { include: { show: true } } } },
      },
    });

    if (
      existingSource &&
      existingSource.movie &&
      existingSource.movie.id !== movieId
    ) {
      throw i18nError.conflict(ERROR_KEYS.MAGNET_ALREADY_ATTACHED, {
        title: existingSource.movie.title,
      });
    }

    if (existingSource && existingSource.episode) {
      throw i18nError.conflict(ERROR_KEYS.MAGNET_ALREADY_ATTACHED, {
        title: episodeDisplayTitle(existingSource.episode),
      });
    }

 
    const sameTarget = existingSource?.movie?.id === movieId;

    if (existingSource && sameTarget && existingSource.status !== 'ERROR') {
      return this.prisma.movie.findUniqueOrThrow({ where: { id: movieId } });
    }

    // Spec 087, REQ-2
    if (
      (movie.status === 'COMPLETED' || (await this.downloadsService.hasDeliveredSource({ movieId }))) &&
      !input.force
    ) {
      throw i18nError.conflict(ERROR_KEYS.MOVIE_ALREADY_COMPLETED);
    }

    if (existingSource && sameTarget) {
      const hash = input.infoHash.toLowerCase();
      const held = (await this.qbittorrent.info()).find(
        (torrent) => torrent.hash.toLowerCase() === hash,
      );

      if (held) {
        const finished = held.state === 'READY';
        if (!finished) await this.qbittorrent.start(hash);

        // Spec 087, REQ-3 REQ-4
        if (input.force) await this.downloadsService.demoteDeliveredSources({ movieId }, 'movie replacement');
        await this.prisma.mediaSource.update({
          where: { id: existingSource.id },
          data: {
            status: 'QUEUED',
            errorMessage: null,
            errorKey: null,
            errorParams: null,
          },
        });
        await this.prisma.movie.update({
          where: { id: movieId },
          data: { status: 'DOWNLOADING' },
        });
        if (finished) await this.downloadsService.handleTorrentCompleted(hash);

        return this.prisma.movie.findUniqueOrThrow({ where: { id: movieId } });
      }
    }

    const downloadPath = await this.qbittorrent.add(
      input.urls,
      movieTags(movie),
      movie.isShort ? 'short' : 'movie',
    );

    // Demote *before* creating the replacement, and only after qBittorrent
    // has accepted the new torrent — so a rejected add() leaves the
    // previously active source untouched.

    // Spec 087, REQ-3 REQ-4
    if (input.force) await this.downloadsService.demoteDeliveredSources({ movieId }, 'movie replacement');

    existingSource
      ? await this.prisma.mediaSource.update({
          where: { id: existingSource.id },
          data: {
            kind: input.kind,
            status: 'QUEUED',
            downloadUrl: input.urls[0] ?? null,
            releaseTitle: input.releaseTitle,
            downloadPath,
            errorMessage: null,
            movieId,
          },
        })
      : await this.prisma.mediaSource.create({
          data: {
            kind: input.kind,
            status: 'QUEUED',
            infoHash: input.infoHash,
            downloadUrl: input.urls[0] ?? null,
            releaseTitle: input.releaseTitle,
            downloadPath,
            movieId,
          },
        });

    return this.prisma.movie.update({
      where: { id: movieId },
      data: { status: 'DOWNLOADING' },
    });
  }

  private async cacheMovies(results: MediaSearchResult[]): Promise<void> {
    if (!results.length) return;

    try {
      const pipeline = this.redis.pipeline();

      for (const movie of results) {
        pipeline.set(
          this.cacheKey(movie.id),
          JSON.stringify(movie),
          'EX',
          TMDB_CACHE_TTL_SECONDS,
        );
      }

      const execResults = await pipeline.exec();

      const failed = (execResults ?? []).filter(([err]) => err);
      if (failed.length) {
        console.error(
          `Error caching ${failed.length} TMDB movie(s) in Redis:`,
          failed.map(([err]) => err?.message),
        );
      }
    } catch (err) {
      console.error('Error guardando resultados de TMDB en Redis:', err);
    }
  }
}
