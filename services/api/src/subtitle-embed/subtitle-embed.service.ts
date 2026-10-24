import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, SubtitleEmbed as SubtitleEmbedRow } from '@prisma/client';
import { stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { PrismaService } from '@/prisma/prisma.service';
import { MediaServerService } from '@/media-server/media-server.service';
import { MediaRootsService } from '@/media-roots/media-roots.service';
import { SubtitleEmbedQueueService } from '@/queue/subtitle-embed-queue.service';
import { ItemSubtitles, MediaServerClient } from '@/clients/media-server/types';
import { episodeKey } from '@/clients/media-server/jellyfin';
import { MEDIA_TYPE } from '@/types/media';
import {
  IN_FLIGHT_ENCODE_STATUSES,
  hasPossession,
  isLiftedBySeasonPack,
} from '@/pipeline-status/pipeline-status';
import { i18nError } from '@/i18n/i18n-error';
import { ERROR_KEYS } from '@/i18n/error-keys';
import type { AuthPrincipal } from '@/auth/auth.types';
import { ActiveEmbedGuard } from './active-embed.guard';
import { ExternalSubtitle } from './entities/external-subtitle.entity';
import { SubtitleEmbed } from './entities/subtitle-embed.entity';
import { SubtitleEmbedDetails } from './entities/subtitle-embed-details.entity';
import { SubtitleEmbedInput } from './dto/subtitle-embed.input';
import { SubtitleEmbedStatus } from './entities/subtitle-embed-status.enum';

// Spec 101, REQ-4
const MAX_OFFSET_MS = 600_000;

// Spec 101, REQ-12
const WORKER_ERROR_KEYS: string[] = [
  ERROR_KEYS.SUBTITLE_EMBED_SUBTITLE_UNREADABLE,
  ERROR_KEYS.SUBTITLE_EMBED_CHARSET_UNDETECTED,
  ERROR_KEYS.SUBTITLE_EMBED_REMUX_FAILED,
  ERROR_KEYS.SUBTITLE_EMBED_VERIFY_FAILED,
  ERROR_KEYS.SUBTITLE_EMBED_NOT_WRITABLE,
];

// Spec 101, NFR-2
export type SubtitleEmbedRequestMemo = {
  admin: Map<string, Promise<boolean>>;
  series: Map<number, Promise<Map<string, ItemSubtitles> | null>>;
};

export function newRequestMemo(): SubtitleEmbedRequestMemo {
  return { admin: new Map(), series: new Map() };
}

export type TargetRef =
  { kind: 'movie'; id: number } | { kind: 'episode'; id: number };

// Spec 103, REQ-11
export type StagedTrackInput = {
  languageIso3: string;
  stagedPath: string;
  offsetMs: number;
};

type TargetFacts = {
  filePath: string | null;
  mediaServerPresentAt: Date | null;
};

type StoredTrack = {
  fileName: string;
  languageIso3: string;
  trackTitle: string;
  isDefault: boolean;
  isForced: boolean;
  offsetMs: number;
  // Spec 103, REQ-11
  stagedPath?: string;
};

function toExternalSubtitle(
  stream: ItemSubtitles['subtitles'][number],
): ExternalSubtitle {
  return {
    fileName: basename(stream.hostPath),
    languageIso3: stream.languageIso3,
    isForced: stream.isForced,
    title: stream.displayTitle,
  };
}

function toEntity(row: SubtitleEmbedRow): SubtitleEmbed {
  return {
    id: row.id,
    status: row.status as SubtitleEmbedStatus,
    errorKey: row.errorKey,
    warningKey: row.warningKey,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
  };
}

// Spec 101, REQ-4
function isBareFileName(fileName: string): boolean {
  return (
    fileName.length > 0 &&
    !fileName.includes('/') &&
    !fileName.includes('\\') &&
    !fileName.includes('..') &&
    !fileName.includes('\0')
  );
}

// Spec 101, REQ-1 REQ-12 REQ-13 REQ-15 REQ-16 REQ-17
@Injectable()
export class SubtitleEmbedService {
  private readonly logger = new Logger(SubtitleEmbedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaServer: MediaServerService,
    private readonly mediaRoots: MediaRootsService,
    private readonly queue: SubtitleEmbedQueueService,
    private readonly activeEmbed: ActiveEmbedGuard,
  ) {}

  // Spec 101, REQ-2 REQ-3
  private async isAdmin(
    principal: AuthPrincipal,
    memo?: SubtitleEmbedRequestMemo,
  ): Promise<boolean> {
    if (principal.type !== 'user') return false;
    const userId = principal.id;

    const read = async () => {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { isAdmin: true },
      });
      return user?.isAdmin === true;
    };

    if (!memo) return read();
    let cached = memo.admin.get(userId);
    if (!cached) {
      cached = read();
      memo.admin.set(userId, cached);
    }
    return cached;
  }

  // Spec 101, REQ-1 REQ-2
  async externalSubtitlesForMovie(
    movieId: number,
    principal: AuthPrincipal,
    memo?: SubtitleEmbedRequestMemo,
  ): Promise<ExternalSubtitle[]> {
    try {
      if (!(await this.isAdmin(principal, memo))) return [];

      const client = await this.listingClient();
      if (!client) return [];

      const movie = await this.prisma.movie.findUnique({
        where: { id: movieId },
        select: { tmdbId: true },
      });
      if (!movie) return [];

      const itemId = await client.findByTmdbId(MEDIA_TYPE.MOVIE, movie.tmdbId);
      if (!itemId) return [];

      const item = await client.listItemSubtitles!(itemId);
      return item.subtitles.map(toExternalSubtitle);
    } catch (error) {
      this.logger.warn(
        `Could not list external subtitles of movie ${movieId}: ${String(error)}`,
      );
      return [];
    }
  }

  // Spec 101, REQ-1 REQ-2 NFR-2
  async externalSubtitlesForEpisode(
    episodeId: number,
    principal: AuthPrincipal,
    memo?: SubtitleEmbedRequestMemo,
  ): Promise<ExternalSubtitle[]> {
    try {
      if (!(await this.isAdmin(principal, memo))) return [];

      const client = await this.listingClient();
      if (!client) return [];

      const episode = await this.prisma.episode.findUnique({
        where: { id: episodeId },
        select: {
          episodeNumber: true,
          season: {
            select: { seasonNumber: true, show: { select: { tmdbId: true } } },
          },
        },
      });
      if (!episode) return [];

      const tmdbId = episode.season.show.tmdbId;
      const loadSeries = async () => {
        try {
          return await this.readSeriesListing(client, tmdbId);
        } catch (error) {
          this.logger.warn(
            `Could not list episode subtitles of show tmdb ${tmdbId}: ${String(error)}`,
          );
          return null;
        }
      };

      let listing: Promise<Map<string, ItemSubtitles> | null>;
      if (memo) {
        let cached = memo.series.get(tmdbId);
        if (!cached) {
          cached = loadSeries();
          memo.series.set(tmdbId, cached);
        }
        listing = cached;
      } else {
        listing = loadSeries();
      }

      const map = await listing;
      const item = map?.get(
        episodeKey(episode.season.seasonNumber, episode.episodeNumber),
      );
      return item ? item.subtitles.map(toExternalSubtitle) : [];
    } catch (error) {
      this.logger.warn(
        `Could not list external subtitles of episode ${episodeId}: ${String(error)}`,
      );
      return [];
    }
  }

  // Spec 101, REQ-17
  async latestEmbedForMovie(movieId: number): Promise<SubtitleEmbed | null> {
    const row = await this.prisma.subtitleEmbed.findFirst({
      where: { movieId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return row ? toEntity(row) : null;
  }

  // Spec 101, REQ-17
  async latestEmbedForEpisode(
    episodeId: number,
  ): Promise<SubtitleEmbed | null> {
    const row = await this.prisma.subtitleEmbed.findFirst({
      where: { episodeId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return row ? toEntity(row) : null;
  }

  // Spec 101, REQ-18
  embedMovie(movieId: number, subtitles: SubtitleEmbedInput[], userId: string) {
    return this.embed({ kind: 'movie', id: movieId }, subtitles, userId);
  }

  // Spec 101, REQ-18
  embedEpisode(
    episodeId: number,
    subtitles: SubtitleEmbedInput[],
    userId: string,
  ) {
    return this.embed({ kind: 'episode', id: episodeId }, subtitles, userId);
  }

  // Spec 101, REQ-3 REQ-4 REQ-13 REQ-14 REQ-15 REQ-16
  private async embed(
    ref: TargetRef,
    subtitles: SubtitleEmbedInput[],
    userId: string,
  ): Promise<SubtitleEmbed> {
    const target = await this.resolveTarget(ref, userId);

    const client = await this.listingClient();
    if (!client) {
      throw i18nError.badRequest(
        ERROR_KEYS.SUBTITLE_EMBED_UNSUPPORTED_MEDIA_SERVER,
      );
    }

    const baseTitles = await this.validateSelection(subtitles);

    if (!hasPossession(target)) {
      throw i18nError.badRequest(ERROR_KEYS.SUBTITLE_EMBED_NO_FILE);
    }

    // Spec 101, REQ-13
    const resolved = await this.resolveMkvPath(client, ref, target);
    let listed = resolved.listed;
    const mkvPath = resolved.mkvPath;
    await this.assertUsableMkv(mkvPath);

    await this.assertNotBusy(ref, target);

    // Spec 101, REQ-15
    listed ??= await this.readItemListing(client, ref, target);
    const listedByName = new Map(
      (listed?.subtitles ?? []).map((stream) => [
        basename(stream.hostPath),
        stream,
      ]),
    );
    const mkvDir = dirname(mkvPath);
    for (const subtitle of subtitles) {
      if (!listedByName.has(subtitle.fileName)) {
        throw i18nError.conflict(ERROR_KEYS.SUBTITLE_EMBED_STALE_LISTING);
      }
      if (!(await this.isRegularFile(join(mkvDir, subtitle.fileName)))) {
        throw i18nError.conflict(ERROR_KEYS.SUBTITLE_EMBED_STALE_LISTING);
      }
    }

    const tracks: StoredTrack[] = subtitles.map((subtitle) => ({
      fileName: subtitle.fileName,
      languageIso3: subtitle.languageIso3,
      trackTitle:
        baseTitles.get(subtitle.languageIso3) ?? subtitle.languageIso3,
      isDefault: subtitle.isDefault,
      isForced: listedByName.get(subtitle.fileName)!.isForced,
      offsetMs: subtitle.offsetMs,
    }));

    return this.queueEmbed(ref, mkvPath, tracks);
  }

  // Spec 103, REQ-11
  async embedStaged(
    ref: TargetRef,
    staged: StagedTrackInput[],
  ): Promise<SubtitleEmbed> {
    if (staged.length === 0) {
      throw i18nError.badRequest(ERROR_KEYS.SUBTITLE_EMBED_EMPTY_SELECTION);
    }

    for (const track of staged) {
      if (
        !(await this.mediaRoots.isInsideRoot('downloads', track.stagedPath))
      ) {
        throw i18nError.badRequest(
          ERROR_KEYS.SUBTITLE_EMBED_SUBTITLE_UNREADABLE,
        );
      }
      this.assertOffsetInRange(track.offsetMs);
    }

    const target = await this.resolveTarget(ref, null);
    if (!hasPossession(target)) {
      throw i18nError.badRequest(ERROR_KEYS.SUBTITLE_EMBED_NO_FILE);
    }

    const baseTitles = await this.lookupBaseTitles(
      staged.map((track) => track.languageIso3),
    );

    const client = target.filePath ? null : await this.listingClient();
    if (!target.filePath && !client) {
      throw i18nError.badRequest(
        ERROR_KEYS.SUBTITLE_EMBED_UNSUPPORTED_MEDIA_SERVER,
      );
    }
    const { mkvPath } = await this.resolveMkvPath(client, ref, target);
    await this.assertUsableMkv(mkvPath);

    await this.assertNotBusy(ref, target);

    const tracks: StoredTrack[] = staged.map((track) => ({
      fileName: basename(track.stagedPath),
      stagedPath: track.stagedPath,
      languageIso3: track.languageIso3,
      trackTitle: baseTitles.get(track.languageIso3) ?? track.languageIso3,
      isDefault: false,
      isForced: false,
      offsetMs: track.offsetMs,
    }));

    return this.queueEmbed(ref, mkvPath, tracks);
  }

  // Spec 101, REQ-10
  private async queueEmbed(
    ref: TargetRef,
    mkvPath: string,
    tracks: StoredTrack[],
  ): Promise<SubtitleEmbed> {
    const targetColumn =
      ref.kind === 'movie' ? { movieId: ref.id } : { episodeId: ref.id };
    const row = await this.createGuarded(targetColumn, mkvPath, tracks);

    try {
      await this.queue.addEmbed({ subtitleEmbedId: row.id });
    } catch (error) {
      await this.prisma.subtitleEmbed.delete({ where: { id: row.id } });
      throw error;
    }

    return toEntity(row);
  }

  // Spec 101, REQ-13
  private async resolveMkvPath(
    client: MediaServerClient | null,
    ref: TargetRef,
    target: TargetFacts & {
      tmdbId?: number;
      seasonNumber?: number;
      episodeNumber?: number;
    },
  ): Promise<{ mkvPath: string; listed: ItemSubtitles | null }> {
    if (target.filePath) return { mkvPath: target.filePath, listed: null };

    const listed = await this.readItemListing(client!, ref, target);
    if (!listed?.mediaHostPath) {
      throw i18nError.badRequest(ERROR_KEYS.SUBTITLE_EMBED_NO_FILE);
    }
    const translated = this.mediaRoots.hostToContainerPath(
      'library',
      listed.mediaHostPath,
    );
    if (!translated) {
      throw i18nError.badRequest(ERROR_KEYS.SUBTITLE_EMBED_OUTSIDE_LIBRARY);
    }
    return { mkvPath: translated, listed };
  }

  // Spec 101, REQ-3
  private async resolveTarget(
    ref: TargetRef,
    userId: string | null,
  ): Promise<
    TargetFacts & {
      tmdbId?: number;
      releaseDate?: Date | null;
      seasonId?: number;
      seasonNumber?: number;
      episodeNumber?: number;
    }
  > {
    if (ref.kind === 'movie') {
      const movie = await this.prisma.movie.findFirst({
        where: {
          id: ref.id,
          ...(userId === null ? {} : { users: { some: { userId } } }),
        },
        select: { tmdbId: true, filePath: true, mediaServerPresentAt: true },
      });
      if (!movie)
        throw i18nError.notFound(ERROR_KEYS.MOVIE_NOT_FOUND, { id: ref.id });
      return movie;
    }

    const episode = await this.prisma.episode.findFirst({
      where: {
        id: ref.id,
        ...(userId === null
          ? {}
          : { season: { show: { users: { some: { userId } } } } }),
      },
      select: {
        filePath: true,
        mediaServerPresentAt: true,
        releaseDate: true,
        episodeNumber: true,
        seasonId: true,
        season: {
          select: { seasonNumber: true, show: { select: { tmdbId: true } } },
        },
      },
    });
    if (!episode)
      throw i18nError.notFound(ERROR_KEYS.EPISODE_NOT_FOUND, { id: ref.id });
    return {
      filePath: episode.filePath,
      mediaServerPresentAt: episode.mediaServerPresentAt,
      releaseDate: episode.releaseDate,
      tmdbId: episode.season.show.tmdbId,
      seasonId: episode.seasonId,
      seasonNumber: episode.season.seasonNumber,
      episodeNumber: episode.episodeNumber,
    };
  }

  // Spec 101, REQ-2
  private async listingClient(): Promise<MediaServerClient | null> {
    const client = await this.mediaServer.createClient();
    if (
      !client ||
      !client.listItemSubtitles ||
      !client.listSeriesEpisodeSubtitles
    )
      return null;
    return client;
  }

  private async readSeriesListing(
    client: MediaServerClient,
    showTmdbId: number,
  ): Promise<Map<string, ItemSubtitles> | null> {
    const seriesId = await client.findByTmdbId(MEDIA_TYPE.SHOW, showTmdbId);
    if (!seriesId) return null;
    return client.listSeriesEpisodeSubtitles!(seriesId);
  }

  // Spec 101, REQ-15
  private async readItemListing(
    client: MediaServerClient,
    ref: TargetRef,
    target: { tmdbId?: number; seasonNumber?: number; episodeNumber?: number },
  ): Promise<ItemSubtitles | null> {
    try {
      if (ref.kind === 'movie') {
        const itemId = await client.findByTmdbId(
          MEDIA_TYPE.MOVIE,
          target.tmdbId!,
        );
        return itemId ? await client.listItemSubtitles!(itemId) : null;
      }
      const map = await this.readSeriesListing(client, target.tmdbId!);
      return (
        map?.get(episodeKey(target.seasonNumber!, target.episodeNumber!)) ??
        null
      );
    } catch (error) {
      this.logger.warn(
        `Jellyfin read failed while embedding ${ref.kind} ${ref.id}: ${String(error)}`,
      );
      throw i18nError.serviceUnavailable(
        ERROR_KEYS.SUBTITLE_EMBED_MEDIA_SERVER_UNAVAILABLE,
      );
    }
  }

  // Spec 101, REQ-4 REQ-5
  private async validateSelection(
    subtitles: SubtitleEmbedInput[],
  ): Promise<Map<string, string>> {
    if (subtitles.length === 0) {
      throw i18nError.badRequest(ERROR_KEYS.SUBTITLE_EMBED_EMPTY_SELECTION);
    }

    const names = new Set<string>();
    for (const subtitle of subtitles) {
      if (names.has(subtitle.fileName)) {
        throw i18nError.badRequest(
          ERROR_KEYS.SUBTITLE_EMBED_DUPLICATE_SUBTITLE,
        );
      }
      names.add(subtitle.fileName);
    }

    if (subtitles.filter((subtitle) => subtitle.isDefault).length > 1) {
      throw i18nError.badRequest(ERROR_KEYS.SUBTITLE_EMBED_MULTIPLE_DEFAULTS);
    }

    for (const subtitle of subtitles) {
      this.assertOffsetInRange(subtitle.offsetMs);
    }

    const baseTitles = await this.lookupBaseTitles(
      subtitles.map((subtitle) => subtitle.languageIso3),
    );

    for (const subtitle of subtitles) {
      if (!isBareFileName(subtitle.fileName)) {
        throw i18nError.conflict(ERROR_KEYS.SUBTITLE_EMBED_STALE_LISTING);
      }
    }

    return baseTitles;
  }

  // Spec 101, REQ-4
  private assertOffsetInRange(offsetMs: number): void {
    if (
      !Number.isInteger(offsetMs) ||
      offsetMs < -MAX_OFFSET_MS ||
      offsetMs > MAX_OFFSET_MS
    ) {
      throw i18nError.badRequest(ERROR_KEYS.SUBTITLE_EMBED_OFFSET_OUT_OF_RANGE);
    }
  }

  // Spec 101, REQ-4 REQ-5
  private async lookupBaseTitles(
    languages: string[],
  ): Promise<Map<string, string>> {
    const requested = [...new Set(languages)];
    const rows = await this.prisma.language.findMany({
      where: { iso3: { in: requested } },
      select: { tag: true, iso2: true, iso3: true, trackTitle: true },
    });
    const baseTitles = new Map<string, string>();
    for (const iso3 of requested) {
      const known = rows.filter((row) => row.iso3 === iso3);
      if (known.length === 0) {
        throw i18nError.badRequest(ERROR_KEYS.SUBTITLE_EMBED_UNKNOWN_LANGUAGE, {
          language: iso3,
        });
      }
      // Spec 101, REQ-5
      const base = known.find((row) => row.tag === row.iso2);
      baseTitles.set(iso3, base?.trackTitle ?? iso3);
    }

    return baseTitles;
  }

  // Spec 101, REQ-13
  private async assertUsableMkv(mkvPath: string): Promise<void> {
    if (!mkvPath.toLowerCase().endsWith('.mkv')) {
      throw i18nError.badRequest(ERROR_KEYS.SUBTITLE_EMBED_NOT_MKV);
    }
    if (!(await this.mediaRoots.isInsideRoot('library', mkvPath))) {
      throw i18nError.badRequest(ERROR_KEYS.SUBTITLE_EMBED_OUTSIDE_LIBRARY);
    }
    if (!(await this.isRegularFile(mkvPath))) {
      throw i18nError.badRequest(ERROR_KEYS.SUBTITLE_EMBED_NO_FILE);
    }
  }

  private async isRegularFile(path: string): Promise<boolean> {
    try {
      return (await stat(path)).isFile();
    } catch {
      return false;
    }
  }

  // Spec 101, REQ-16
  private async assertNotBusy(
    ref: TargetRef,
    target: { releaseDate?: Date | null; seasonId?: number },
  ): Promise<void> {
    const column =
      ref.kind === 'movie' ? { movieId: ref.id } : { episodeId: ref.id };

    const activeSources = await this.prisma.mediaSource.count({
      where: {
        ...column,
        retiredAt: null,
        status: { notIn: ['ERROR', 'SCANNED'] },
      },
    });
    const activeJobs = await this.prisma.processJob.count({
      where: { ...column, status: { in: IN_FLIGHT_ENCODE_STATUSES } },
    });

    let packInFlight = false;
    if (ref.kind === 'episode' && target.seasonId !== undefined) {
      const seasonSources = await this.prisma.mediaSource.findMany({
        where: { seasonId: target.seasonId },
        select: { status: true },
      });
      packInFlight = isLiftedBySeasonPack(
        seasonSources,
        target.releaseDate ?? null,
        new Date(),
      );
    }

    if (
      activeSources > 0 ||
      activeJobs > 0 ||
      packInFlight ||
      (await this.activeEmbed.hasActiveEmbed(column))
    ) {
      throw i18nError.conflict(ERROR_KEYS.SUBTITLE_EMBED_BUSY);
    }
  }

  // Spec 101, REQ-16
  private async createGuarded(
    column: { movieId: number } | { episodeId: number },
    filePath: string,
    tracks: StoredTrack[],
  ): Promise<SubtitleEmbedRow> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const active = await tx.subtitleEmbed.count({
            where: { ...column, status: { in: ['QUEUED', 'RUNNING'] } },
          });
          if (active > 0) {
            throw i18nError.conflict(ERROR_KEYS.SUBTITLE_EMBED_BUSY);
          }
          return tx.subtitleEmbed.create({
            data: {
              ...column,
              filePath,
              tracks: tracks as unknown as Prisma.InputJsonValue,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      // Spec 101, REQ-16
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      ) {
        throw i18nError.conflict(ERROR_KEYS.SUBTITLE_EMBED_BUSY);
      }
      throw error;
    }
  }

  // Spec 101, REQ-17
  async started(id: number): Promise<boolean> {
    const result = await this.prisma.subtitleEmbed.updateMany({
      where: { id, status: 'QUEUED' },
      data: { status: 'RUNNING' },
    });
    return result.count === 1;
  }

  // Spec 101, REQ-11
  async failed(id: number, errorKey: string): Promise<boolean> {
    const row = await this.prisma.subtitleEmbed.findUnique({ where: { id } });
    if (!row) return false;
    if (row.status !== 'QUEUED' && row.status !== 'RUNNING') return true;

    let key = errorKey;
    if (!WORKER_ERROR_KEYS.includes(errorKey)) {
      this.logger.warn(
        `Unknown subtitle embed error key "${errorKey}" for embed ${id}; storing remux_failed`,
      );
      key = ERROR_KEYS.SUBTITLE_EMBED_REMUX_FAILED;
    }

    await this.prisma.subtitleEmbed.updateMany({
      where: { id, status: { in: ['QUEUED', 'RUNNING'] } },
      data: { status: 'FAILED', errorKey: key, finishedAt: new Date() },
    });
    return true;
  }

  // Spec 101, REQ-12
  async completed(
    id: number,
    workerWarningKey: string | null,
  ): Promise<boolean> {
    const row = await this.prisma.subtitleEmbed.findUnique({ where: { id } });
    if (!row) return false;
    if (row.status !== 'RUNNING') return true;

    let warningKey: string | null = null;
    if (workerWarningKey !== null && workerWarningKey !== undefined) {
      if (
        workerWarningKey !== ERROR_KEYS.SUBTITLE_EMBED_SIDECAR_DELETE_FAILED
      ) {
        this.logger.warn(
          `Unexpected subtitle embed warning key "${workerWarningKey}" for embed ${id}`,
        );
      }
      warningKey = ERROR_KEYS.SUBTITLE_EMBED_SIDECAR_DELETE_FAILED;
    }

    const claimed = await this.prisma.subtitleEmbed.updateMany({
      where: { id, status: 'RUNNING' },
      data: { status: 'COMPLETED', warningKey, finishedAt: new Date() },
    });
    if (claimed.count !== 1) return true;

    if (!(await this.notifyJellyfin(row.filePath)) && warningKey === null) {
      await this.prisma.subtitleEmbed.update({
        where: { id },
        data: { warningKey: ERROR_KEYS.SUBTITLE_EMBED_JELLYFIN_REFRESH_FAILED },
      });
    }
    return true;
  }

  // Spec 101, REQ-12
  private async notifyJellyfin(containerFilePath: string): Promise<boolean> {
    try {
      const client = await this.mediaServer.createClient();
      if (!client?.modifiedMedia) {
        this.logger.warn(
          'Jellyfin refresh skipped: no media server client that can be notified',
        );
        return false;
      }
      const hostPath = this.mediaRoots.containerToHostPath(
        'library',
        containerFilePath,
      );
      if (!hostPath) {
        this.logger.warn(
          `Jellyfin refresh skipped: ${containerFilePath} has no host path`,
        );
        return false;
      }
      await client.modifiedMedia(hostPath);
      return true;
    } catch (error) {
      this.logger.warn(`Jellyfin refresh failed: ${String(error)}`);
      return false;
    }
  }

  // Spec 101, REQ-14
  async details(id: number): Promise<SubtitleEmbedDetails> {
    const row = await this.prisma.subtitleEmbed.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`SubtitleEmbed ${id} does not exist`);

    const dir = dirname(row.filePath);
    const tracks = (row.tracks as unknown as StoredTrack[]).map((track) => ({
      sourcePath: track.stagedPath ?? join(dir, track.fileName),
      isSidecar: track.stagedPath == null,
      languageIso3: track.languageIso3,
      trackTitle: track.trackTitle,
      isDefault: track.isDefault,
      isForced: track.isForced,
      offsetMs: track.offsetMs,
    }));

    return { id: row.id, filePath: row.filePath, tracks };
  }
}
