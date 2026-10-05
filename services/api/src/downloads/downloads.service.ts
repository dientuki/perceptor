import { Injectable } from '@nestjs/common';
import { dirname } from 'node:path';
import { rm, rmdir } from 'node:fs/promises';
import { EncodeStatus, SourceStatus } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { ProcessQueueService } from '@/queue/process-queue.service';
import { EncodeQueueService } from '@/queue/encode-queue.service';
import { QbittorrentClient, TorrentClientError } from '@/clients/torrent/client';
import { TorrentClientInfo } from '@/clients/torrent/types';
import { SettingsService } from '@/settings/settings.service';
import { MediaRootsService } from '@/media-roots/media-roots.service';
import { ERROR_KEYS } from '@/i18n/error-keys';
import { MESSAGES_EN } from '@/i18n/messages.en';
import { i18nError } from '@/i18n/i18n-error';
import {
  deriveSourceStatus,
  deriveTitleStatus,
  toMediaStatus,
  deriveResume,
  isRaceWinner,
  SourceAltitudeJob,
  ResumeJob,
  ResumeSibling,
} from '@/pipeline-status/pipeline-status';
import { Download } from './entities/download.entity';

// Spec 022, REQ-5
function sanitizeTag(title: string, fallbackId: number): string {
  const cleaned = title.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned || `id-${fallbackId}`;
}

function episodeLabel(show: { title: string }, season: { seasonNumber: number }, episode: { episodeNumber: number }): string {
  const s = String(season.seasonNumber).padStart(2, '0');
  const e = String(episode.episodeNumber).padStart(2, '0');
  return `${show.title} S${s}E${e}`;
}

function seasonLabel(show: { title: string }, season: { seasonNumber: number }): string {
  return `${show.title} S${String(season.seasonNumber).padStart(2, '0')}`;
}

type DownloadJob = SourceAltitudeJob & ResumeJob & { id: number };

type JobsForSource = { jobs: DownloadJob[]; latestUpdatedAt: Date | null };

type SiblingSource = {
  id: number;
  status: SourceStatus;
  movieId: number | null;
  seasonId: number | null;
  episodeId: number | null;
};

function targetKey(source: SiblingSource): string {
  if (source.movieId) return `movie:${source.movieId}`;
  if (source.episodeId) return `episode:${source.episodeId}`;
  if (source.seasonId) return `season:${source.seasonId}`;
  return `source:${source.id}`;
}

function siblingsIn(
  source: SiblingSource,
  all: SiblingSource[],
  jobsBySourceId: Map<number, JobsForSource>,
): ResumeSibling[] {
  const key = targetKey(source);
  return all
    .filter((other) => other.id !== source.id && targetKey(other) === key)
    .map((other) => ({ status: other.status, jobs: jobsBySourceId.get(other.id)?.jobs ?? [] }));
}

function byLastActivity<T extends { id: number; updatedAt: Date }>(
  sources: T[],
  jobsBySourceId: Map<number, JobsForSource>,
): T[] {
  const activity = (source: T): number =>
    Math.max(source.updatedAt.getTime(), jobsBySourceId.get(source.id)?.latestUpdatedAt?.getTime() ?? 0);
  return [...sources].sort((a, b) => activity(b) - activity(a) || b.id - a.id);
}

type OwnedTitle = { id: number; title: string; users: unknown[] };

type TargetSource = {
  movie?: OwnedTitle | null;
  season?: { seasonNumber: number; show: OwnedTitle } | null;
  episode?: { episodeNumber: number; season: { seasonNumber: number; show: OwnedTitle } } | null;
};

type Target = {
  label: string;
  seasonNumber?: number;
  showId?: number;
  showTitle?: string;
  owned: boolean;
};

function projectTarget(source: TargetSource): Target {
  if (source.movie) {
    return { label: source.movie.title, owned: source.movie.users.length > 0 };
  }
  if (source.episode) {
    const { season } = source.episode;
    return {
      label: episodeLabel(season.show, season, source.episode),
      showId: season.show.id,
      showTitle: season.show.title,
      owned: season.show.users.length > 0,
    };
  }
  if (source.season) {
    const { show } = source.season;
    return {
      label: seasonLabel(show, source.season),
      seasonNumber: source.season.seasonNumber,
      showId: show.id,
      showTitle: show.title,
      owned: show.users.length > 0,
    };
  }
  return { label: '', owned: false };
}

function targetInclude(userId: string) {
  const users = { where: { userId } };
  return {
    movie: { include: { users } },
    episode: { include: { season: { include: { show: { include: { users } } } } } },
    season: { include: { show: { include: { users } } } },
  };
}

const ACTIVE_STATUSES: ReadonlySet<string> = new Set(['QUEUED', 'DOWNLOADING', 'DOWNLOADED', 'ENCODING']);

type MediaSourceRow = {
  id: number;
  kind: string;
  status: SourceStatus;
  infoHash: string | null;
  releaseTitle: string | null;
  downloadPath: string | null;
  errorKey: string | null;
  errorParams: string | null;
  errorMessage: string | null;
  updatedAt: Date;
  movieId: number | null;
  seasonId: number | null;
  episodeId: number | null;
};

@Injectable()
export class DownloadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: ProcessQueueService,
    private readonly encodeQueue: EncodeQueueService,
    private readonly qbittorrent: QbittorrentClient,
    private readonly settings: SettingsService,
    private readonly mediaRoots: MediaRootsService,
  ) {}

  // Spec 022, REQ-9 REQ-10
  private async liveInfoByHash(tag?: string): Promise<Map<string, TorrentClientInfo>> {
    try {
      const rows = await this.qbittorrent.info(tag);
      return new Map(rows.map((row) => [row.hash.toLowerCase(), row]));
    } catch (err) {
      console.error(`[DownloadsService] could not read torrent client state (tag "${tag ?? ''}"):`, err);
      return new Map();
    }
  }

  // Spec 053, REQ-2
  private liveFor(
    source: { infoHash: string | null },
    live: Map<string, TorrentClientInfo>,
  ): TorrentClientInfo | undefined {
    return source.infoHash ? live.get(source.infoHash.toLowerCase()) : undefined;
  }

  // Spec 043, REQ-3
  private async jobsBySourceId(mediaSourceIds: number[]): Promise<Map<number, JobsForSource>> {
    const rows = await this.prisma.processJob.findMany({
      where: { sourceFile: { mediaSourceId: { in: mediaSourceIds } } },
      select: {
        id: true,
        status: true,
        progress: true,
        encodeSpeed: true,
        errorKey: true,
        errorParams: true,
        errorMessage: true,
        updatedAt: true,
        sourceFile: { select: { mediaSourceId: true } },
      },
    });

    const grouped = new Map<number, JobsForSource>();
    for (const row of rows) {
      const mediaSourceId = row.sourceFile.mediaSourceId;
      const entry = grouped.get(mediaSourceId) ?? { jobs: [], latestUpdatedAt: null };
      entry.jobs.push({
        id: row.id,
        status: row.status as EncodeStatus,
        progress: row.progress,
        encodeSpeed: row.encodeSpeed,
        errorKey: row.errorKey,
        errorParams: row.errorParams,
        errorMessage: row.errorMessage,
        updatedAt: row.updatedAt,
      });
      if (!entry.latestUpdatedAt || row.updatedAt > entry.latestUpdatedAt) entry.latestUpdatedAt = row.updatedAt;
      grouped.set(mediaSourceId, entry);
    }
    return grouped;
  }

  private async siblingsOf(source: SiblingSource): Promise<ResumeSibling[]> {
    const targetWhere = source.movieId
      ? { movieId: source.movieId }
      : source.episodeId
        ? { episodeId: source.episodeId }
        : source.seasonId
          ? { seasonId: source.seasonId }
          : null;
    if (!targetWhere) return [];
    const rows = await this.prisma.mediaSource.findMany({
      where: { ...targetWhere, id: { not: source.id } },
      select: { id: true, status: true, movieId: true, seasonId: true, episodeId: true },
    });
    const jobs = await this.jobsBySourceId(rows.map((row) => row.id));
    return siblingsIn(source, [source, ...rows], jobs);
  }

  private async compressionEnabled(): Promise<boolean> {
    const settingsMap = await this.settings.getMap();
    return settingsMap['compression_enabled'] !== 'false';
  }

  private toDownload(
    source: MediaSourceRow,
    target: Target,
    live: TorrentClientInfo | undefined,
    jobs: DownloadJob[],
    compressionEnabled: boolean,
    siblings: ResumeSibling[],
  ): Download {
    const derived = deriveSourceStatus({
      sourceStatus: source.status,
      jobs,
      live: live ? { state: live.state, progress: live.progress } : null,
    });

    const resume = deriveResume({
      status: derived.status,
      source,
      jobs,
      liveState: live?.rawState ?? null,
      siblings,
    });

    return {
      mediaSourceId: source.id,
      infoHash: source.infoHash ?? undefined,
      kind: source.kind,
      label: target.label,
      releaseTitle: source.releaseTitle ?? undefined,
      movieId: source.movieId ?? undefined,
      seasonId: source.seasonId ?? undefined,
      seasonNumber: target.seasonNumber,
      showId: target.showId,
      showTitle: target.showTitle,
      owned: target.owned,
      episodeId: source.episodeId ?? undefined,
      status: derived.status,
      torrentState: live?.rawState,
      downloadProgress: derived.downloadProgress ?? undefined,
      encodeProgress: derived.encodeProgress ?? undefined,
      compressionEnabled,
      downloadSpeed: live?.dlspeed,
      encodeSpeed: derived.encodeSpeed ?? undefined,
      lastError: resume.lastError ?? undefined,
      retryable: resume.retryable,
      readAt: new Date(),
    };
  }

  // Spec 022, REQ-17
  async movieDownloads(movieId: number, userId: string): Promise<Download[]> {
    const movie = await this.prisma.movie.findFirst({
      where: { id: movieId, users: { some: { userId } } },
      select: { id: true, title: true },
    });
    if (!movie) throw i18nError.notFound(ERROR_KEYS.MOVIE_NOT_FOUND, { id: movieId });

    const sources = await this.prisma.mediaSource.findMany({
      where: { movieId },
      include: targetInclude(userId),
    });

    // Spec 022, REQ-4
    const [live, jobsBySourceId, compressionEnabled] = await Promise.all([
      this.liveInfoByHash(sanitizeTag(movie.title, movie.id)),
      this.jobsBySourceId(sources.map((source) => source.id)),
      this.compressionEnabled(),
    ]);

    return byLastActivity(sources, jobsBySourceId).map((source) =>
      this.toDownload(
        source,
        projectTarget(source),
        this.liveFor(source, live),
        jobsBySourceId.get(source.id)?.jobs ?? [],
        compressionEnabled,
        siblingsIn(source, sources, jobsBySourceId),
      ),
    );
  }

  async downloads(userId: string): Promise<Download[]> {
    const sources = await this.prisma.mediaSource.findMany({
      include: targetInclude(userId),
    });

    const [live, jobsBySourceId, compressionEnabled] = await Promise.all([
      this.liveInfoByHash(),
      this.jobsBySourceId(sources.map((source) => source.id)),
      this.compressionEnabled(),
    ]);

    return byLastActivity(sources, jobsBySourceId).map((source) =>
      this.toDownload(
        source,
        projectTarget(source),
        this.liveFor(source, live),
        jobsBySourceId.get(source.id)?.jobs ?? [],
        compressionEnabled,
        siblingsIn(source, sources, jobsBySourceId),
      ),
    );
  }

  async activeDownloadCount(userId: string): Promise<number> {
    const rows = await this.downloads(userId);
    const titles = new Set<string>();
    for (const row of rows) {
      if (!ACTIVE_STATUSES.has(row.status)) continue;
      titles.add(row.showId != null ? `show:${row.showId}` : `movie:${row.movieId}`);
    }
    return titles.size;
  }

  // Same ownership clause ShowsResolver already uses for `show(id)`
  // (009-show-detail) — written locally, not imported (see movieDownloads).
  async showDownloads(showId: number, userId: string): Promise<Download[]> {
    const show = await this.prisma.show.findFirst({
      where: { id: showId, users: { some: { userId } } },
      select: { id: true, title: true },
    });
    if (!show) throw i18nError.notFound(ERROR_KEYS.SHOW_NOT_AVAILABLE);

    // Spec 022, REQ-8
    const sources = await this.prisma.mediaSource.findMany({
      where: {
        OR: [{ season: { showId } }, { episode: { season: { showId } } }],
      },
      include: targetInclude(userId),
    });

    const [live, jobsBySourceId, compressionEnabled] = await Promise.all([
      this.liveInfoByHash(sanitizeTag(show.title, show.id)),
      this.jobsBySourceId(sources.map((source) => source.id)),
      this.compressionEnabled(),
    ]);

    return byLastActivity(sources, jobsBySourceId).map((source) =>
      this.toDownload(
        source,
        projectTarget(source),
        this.liveFor(source, live),
        jobsBySourceId.get(source.id)?.jobs ?? [],
        compressionEnabled,
        siblingsIn(source, sources, jobsBySourceId),
      ),
    );
  }

  // Spec 022, REQ-17
  private async findOwnedSource(mediaSourceId: number, userId: string): Promise<MediaSourceRow & TargetSource> {
    const source = await this.prisma.mediaSource.findUnique({
      where: { id: mediaSourceId },
      include: targetInclude(userId),
    });

    const owned =
      !!source &&
      ((source.movie && source.movie.users.length > 0) ||
        (source.episode && source.episode.season.show.users.length > 0) ||
        (source.season && source.season.show.users.length > 0));

    if (!source || !owned) {
      throw i18nError.notFound(ERROR_KEYS.SOURCE_NOT_FOUND, { id: mediaSourceId });
    }

    return source;
  }

  // Spec 022, REQ-18
  private requireTorrent(source: MediaSourceRow): string {
    if (!source.infoHash) {
      throw i18nError.badRequest(ERROR_KEYS.DOWNLOAD_NOT_A_TORRENT);
    }
    return source.infoHash;
  }

  // Spec 022, NFR-6
  private async callTorrentClient<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (err) {
      const status = err instanceof TorrentClientError ? err.status : 0;
      throw i18nError.serviceUnavailable(ERROR_KEYS.TORRENT_CLIENT_REJECTED, { status });
    }
  }

  // Spec 043, REQ-7; Spec 043, NFR-3
  private static readonly NON_TERMINAL_STATUSES: SourceStatus[] = ['PENDING', 'QUEUED', 'DOWNLOADING', 'PAUSED'];

  // Returns whether the guard matched, so the caller can keep the in-memory
  // row it already has consistent with what was actually written — a
  // matched write means `status` is now the real column value; a skipped
  // one (row already terminal) means the row the caller read is still
  // accurate as-is.
  private async writeStatusIfNonTerminal(mediaSourceId: number, status: SourceStatus): Promise<boolean> {
    const result = await this.prisma.mediaSource.updateMany({
      where: { id: mediaSourceId, status: { in: DownloadsService.NON_TERMINAL_STATUSES } },
      data: { status },
    });
    return result.count > 0;
  }

  async downloadStart(mediaSourceId: number, userId: string): Promise<Download> {
    const source = await this.findOwnedSource(mediaSourceId, userId);

    const [live, jobsBySourceId, siblings] = await Promise.all([
      source.infoHash ? this.liveInfoForHash(source.infoHash) : Promise.resolve(undefined),
      this.jobsBySourceId([source.id]),
      this.siblingsOf(source),
    ]);
    const jobs = jobsBySourceId.get(source.id)?.jobs ?? [];
    const derived = deriveSourceStatus({
      sourceStatus: source.status,
      jobs,
      live: live ? { state: live.state, progress: live.progress } : null,
    });

    if (derived.status === 'ERROR') {
      return this.resumeErroredSource(source, userId, jobs, live, siblings);
    }

    const infoHash = this.requireTorrent(source);

    await this.callTorrentClient(() => this.qbittorrent.start(infoHash));
    if (await this.writeStatusIfNonTerminal(mediaSourceId, 'QUEUED')) {
      source.status = 'QUEUED';
    }

    const [liveAfter, jobsAfter, compressionEnabled, siblingsAfter] = await Promise.all([
      this.liveInfoForHash(infoHash),
      this.jobsBySourceId([source.id]),
      this.compressionEnabled(),
      this.siblingsOf(source),
    ]);
    return this.toDownload(
      source,
      projectTarget(source),
      liveAfter,
      jobsAfter.get(source.id)?.jobs ?? [],
      compressionEnabled,
      siblingsAfter,
    );
  }

  private async resumeErroredSource(
    source: MediaSourceRow & TargetSource,
    userId: string,
    jobs: DownloadJob[],
    live: TorrentClientInfo | undefined,
    siblings: ResumeSibling[],
  ): Promise<Download> {
    const verdict = deriveResume({
      status: 'ERROR',
      source,
      jobs,
      liveState: live?.rawState ?? null,
      siblings,
    });

    if (verdict.refusalKey === ERROR_KEYS.DOWNLOAD_RETRY_REPLACED) {
      throw i18nError.conflict(ERROR_KEYS.DOWNLOAD_RETRY_REPLACED);
    }
    if (verdict.refusalKey === ERROR_KEYS.DOWNLOAD_RETRY_SUPERSEDED) {
      throw i18nError.conflict(ERROR_KEYS.DOWNLOAD_RETRY_SUPERSEDED);
    }
    if (verdict.refusalKey) {
      throw i18nError.badRequest(ERROR_KEYS.DOWNLOAD_RETRY_UNAVAILABLE);
    }

    const stage = verdict.lastError?.stage;
    if (stage === 'ENCODE') {
      await this.resumeEncodeStage(jobs);
    } else if (stage === 'SCAN') {
      await this.resumeScanStage(source.id);
    } else if (stage === 'DOWNLOAD' && source.infoHash) {
      const infoHash = source.infoHash;
      await this.callTorrentClient(() => this.qbittorrent.start(infoHash));
    }

    await this.recomputeStatus(source);

    const fresh = await this.findOwnedSource(source.id, userId);
    const [liveAfter, jobsAfter, compressionEnabled, siblingsAfter] = await Promise.all([
      fresh.infoHash ? this.liveInfoForHash(fresh.infoHash) : Promise.resolve(undefined),
      this.jobsBySourceId([fresh.id]),
      this.compressionEnabled(),
      this.siblingsOf(fresh),
    ]);
    return this.toDownload(
      fresh,
      projectTarget(fresh),
      liveAfter,
      jobsAfter.get(fresh.id)?.jobs ?? [],
      compressionEnabled,
      siblingsAfter,
    );
  }

  private async resumeEncodeStage(jobs: DownloadJob[]): Promise<void> {
    const failed = jobs.filter((job) => job.status === 'ERROR');
    const matched: DownloadJob[] = [];
    for (const job of failed) {
      const result = await this.prisma.processJob.updateMany({
        where: { id: job.id, status: 'ERROR' },
        data: {
          status: 'WAITING',
          progress: 0,
          encodeSpeed: null,
          recoveryCount: 0,
          errorKey: null,
          errorParams: null,
          errorMessage: null,
        },
      });
      if (result.count > 0) matched.push(job);
    }
    if (matched.length === 0) return;

    try {
      for (const job of matched) {
        await this.encodeQueue.removeEncode(job.id);
        await this.encodeQueue.addEncode({ processJobId: job.id });
      }
    } catch (err) {
      console.error('[DownloadsService] failed to re-enqueue encode jobs on resume:', err);
      for (const job of matched) {
        await this.prisma.processJob.updateMany({
          where: { id: job.id, status: 'WAITING' },
          data: {
            status: 'ERROR',
            errorKey: job.errorKey,
            errorParams: job.errorParams,
            errorMessage: job.errorMessage,
          },
        });
      }
      throw i18nError.serviceUnavailable(ERROR_KEYS.DOWNLOAD_RETRY_ENQUEUE_FAILED);
    }

    await this.prisma.processJob.updateMany({
      where: { id: { in: matched.map((job) => job.id) }, status: 'WAITING' },
      data: { status: 'QUEUED' },
    });
  }

  private async resumeScanStage(mediaSourceId: number): Promise<void> {
    const result = await this.prisma.mediaSource.updateMany({
      where: { id: mediaSourceId, status: 'ERROR' },
      data: { status: 'READY' },
    });
    if (result.count === 0) return;

    try {
      await this.resolveRace(mediaSourceId);
      await this.queue.removeSourceReady(mediaSourceId);
      await this.queue.addSourceReady({ mediaSourceId });
    } catch (err) {
      console.error(`[DownloadsService] failed to re-enqueue scan for mediaSource ${mediaSourceId}:`, err);
      await this.prisma.mediaSource.updateMany({
        where: { id: mediaSourceId, status: 'READY' },
        data: { status: 'ERROR' },
      });
      throw i18nError.serviceUnavailable(ERROR_KEYS.DOWNLOAD_RETRY_ENQUEUE_FAILED);
    }
  }

  async downloadStop(mediaSourceId: number, userId: string): Promise<Download> {
    const source = await this.findOwnedSource(mediaSourceId, userId);
    const infoHash = this.requireTorrent(source);

    await this.callTorrentClient(() => this.qbittorrent.stop(infoHash));
    if (await this.writeStatusIfNonTerminal(mediaSourceId, 'PAUSED')) {
      source.status = 'PAUSED';
    }

    const [live, jobsBySourceId, compressionEnabled, siblings] = await Promise.all([
      this.liveInfoForHash(infoHash),
      this.jobsBySourceId([source.id]),
      this.compressionEnabled(),
      this.siblingsOf(source),
    ]);
    return this.toDownload(
      source,
      projectTarget(source),
      live,
      jobsBySourceId.get(source.id)?.jobs ?? [],
      compressionEnabled,
      siblings,
    );
  }

  // Spec 047, NFR-2; Spec 047, REQ-1
  async downloadDelete(mediaSourceId: number, userId: string): Promise<boolean> {
    const source = await this.findOwnedSource(mediaSourceId, userId);

    await this.unwindSource(source, { removeTorrent: true });

    await this.recomputeStatus(source);

    return true;
  }

  // Per-source steps of the unwind, shared by downloadDelete and
  // unwindSourcesForTitle (067). Order is the contract: torrent client first
  // (skipped when the caller already batched it), then queued/running work
  // withdrawn, then disk, then the row.
  private async unwindSource(source: MediaSourceRow, opts: { removeTorrent: boolean }): Promise<void> {
    const mediaSourceId = source.id;
    const jobs = await this.prisma.processJob.findMany({
      where: { sourceFile: { mediaSourceId } },
      select: { id: true },
    });

    if (opts.removeTorrent && source.infoHash) {
      const infoHash = source.infoHash;
      // Spec 047, REQ-2; Spec 047, REQ-11
      await this.callTorrentClient(() => this.qbittorrent.remove(infoHash, true));
    }

    // Spec 047, REQ-3; Spec 047, REQ-4
    for (const job of jobs) {
      await this.encodeQueue.publishCancel(job.id);
      await this.encodeQueue.removeEncode(job.id);
    }
    await this.queue.removeSourceReady(mediaSourceId);

    await this.deleteResidue(source);

    // Cascades remove SourceFile/ProcessJob — never deleted by hand.
    await this.prisma.mediaSource.delete({ where: { id: mediaSourceId } });
  }

  // Spec 067, NFR-2; Spec 067, NFR-3
  async unwindSourcesForTitle(scope: { movieId: number } | { showId: number }): Promise<void> {
    const where =
      'movieId' in scope
        ? { movieId: scope.movieId }
        : {
            OR: [
              { season: { showId: scope.showId } },
              { episode: { season: { showId: scope.showId } } },
            ],
          };
    const sources = await this.prisma.mediaSource.findMany({ where });

    const hashes = sources.map((s) => s.infoHash).filter((h): h is string => !!h);
    if (hashes.length > 0) {
      await this.callTorrentClient(() => this.qbittorrent.remove(hashes, true));
    }

    for (const source of sources) {
      await this.unwindSource(source, { removeTorrent: false });
    }
  }

  // Spec 047, T006; Spec 047, REQ-8; Spec 047, REQ-9; Spec 047, REQ-10
  private async deleteResidue(source: MediaSourceRow): Promise<void> {
    const downloadPath = source.downloadPath;
    if (!downloadPath) {
      console.log(`[DownloadsService] mediaSource ${source.id}: no downloadPath, nothing to delete`);
      return;
    }

    let downloadsRoot: string;
    try {
      const config = await this.settings.getMap();
      downloadsRoot = await this.mediaRoots.resolveFromRoot('downloads', config.path_downloads ?? '.');
    } catch (err) {
      console.error(`[DownloadsService] mediaSource ${source.id}: could not resolve the downloads root:`, err);
      return;
    }

    if (!(await this.mediaRoots.isInsideRoot('downloads', downloadPath))) {
      console.error(
        `[DownloadsService] mediaSource ${source.id}: downloadPath ${downloadPath} is outside the downloads root (${downloadsRoot}) — deleting nothing`,
      );
      return;
    }

    try {
      if (source.kind === 'LOCAL_FILE') {
        // A tus upload: one file staged in its own directory
        // (<downloads>/imports/<uploadId>/<file>). Non-recursive rmdir on
        // purpose — an ENOTEMPTY must leave whatever else is in there alone.
        await rm(downloadPath, { force: true });
        await rmdir(dirname(downloadPath)).catch((err) => {
          console.log(
            `[DownloadsService] mediaSource ${source.id}: could not rmdir ${dirname(downloadPath)} (probably not empty):`,
            err instanceof Error ? err.message : err,
          );
        });
      } else {
        // TORRENT_SEARCH, TORRENT_FILE, LOCAL_FOLDER: the whole download
        // directory (or the file itself, for a single-file torrent) is
        // owned by this source alone.
        await rm(downloadPath, { recursive: true, force: true });
      }
    } catch (err) {
      console.error(`[DownloadsService] mediaSource ${source.id}: could not delete ${downloadPath}:`, err);
    }
  }

  // Spec 047, T007; Spec 047, REQ-12
  private async recomputeStatus(source: MediaSourceRow): Promise<void> {
    if (source.movieId) {
      await this.recomputeMovieStatus(source.movieId);
      return;
    }
    if (source.episodeId) {
      await this.recomputeEpisodeStatus(source.episodeId);
      return;
    }
    if (source.seasonId) {
      const episodes = await this.prisma.episode.findMany({
        where: { seasonId: source.seasonId },
        select: { id: true },
      });
      for (const episode of episodes) {
        await this.recomputeEpisodeStatus(episode.id);
      }
    }
  }

  private async recomputeMovieStatus(movieId: number): Promise<void> {
    const movie = await this.prisma.movie.findUnique({
      where: { id: movieId },
      include: { mediaSources: true, processJobs: true },
    });
    if (!movie) return;

    // Spec 047, REQ-13; Spec 047, AC-12
    if (movie.filePath != null) {
      await this.prisma.movie.update({ where: { id: movieId }, data: { status: 'COMPLETED' } });
      return;
    }

    const derived = deriveTitleStatus({ status: 'MISSING', sources: movie.mediaSources, jobs: movie.processJobs });
    await this.prisma.movie.update({ where: { id: movieId }, data: { status: toMediaStatus(derived) } });
  }

  private async recomputeEpisodeStatus(episodeId: number): Promise<void> {
    const episode = await this.prisma.episode.findUnique({
      where: { id: episodeId },
      include: { mediaSources: true, processJobs: true },
    });
    if (!episode) return;

    if (episode.filePath != null) {
      await this.prisma.episode.update({ where: { id: episodeId }, data: { status: 'COMPLETED' } });
      return;
    }

    const derived = deriveTitleStatus({ status: 'MISSING', sources: episode.mediaSources, jobs: episode.processJobs });
    await this.prisma.episode.update({ where: { id: episodeId }, data: { status: toMediaStatus(derived) } });
  }

  // Single-torrent lookup for the three control mutations above — cheaper
  // and simpler than recomputing a title tag here, and each of these three
  // acts on exactly one hash.
  private async liveInfoForHash(infoHash: string): Promise<TorrentClientInfo | undefined> {
    try {
      const rows = await this.qbittorrent.info();
      const wanted = infoHash.toLowerCase();
      return rows.find((row) => row.hash.toLowerCase() === wanted);
    } catch (err) {
      console.error(`[DownloadsService] could not reread mediaSource state after the mutation:`, err);
      return undefined;
    }
  }

  // Spec 022, REQ-12; Spec 022, REQ-13; Spec 022, REQ-14; Spec 022, REQ-19
  async resolveRace(mediaSourceId: number): Promise<string> {
    const winner = await this.prisma.mediaSource.findUnique({ where: { id: mediaSourceId } });
    if (!winner) {
      console.log(`[torrentCompleted] resolveRace: mediaSource ${mediaSourceId} does not exist`);
      return `ignorado: mediaSource ${mediaSourceId} no existe`;
    }

    // A source already ERROR (027-replace-completed-media's force demotion)
    // is not a legitimate race winner — a defensive guard for any future
    // caller of this method; handleTorrentCompleted below never reaches
    // this with an ERROR source, since its own ERROR rung runs first.
    if (winner.status === 'ERROR') {
      console.log(`[torrentCompleted] resolveRace: mediaSource ${mediaSourceId} is in ERROR, not a valid winner`);
      return `ignorado: mediaSource ${mediaSourceId} está en ERROR`;
    }

    const targetWhere = winner.movieId
      ? { movieId: winner.movieId }
      : winner.episodeId
        ? { episodeId: winner.episodeId }
        : winner.seasonId
          ? { seasonId: winner.seasonId }
          : null;

    if (!targetWhere) {
      console.log(`[torrentCompleted] resolveRace: mediaSource ${mediaSourceId} has no target`);
      return `ignorado: mediaSource ${mediaSourceId} sin target`;
    }

    const siblings = await this.prisma.mediaSource.findMany({
      where: { ...targetWhere, id: { not: mediaSourceId } },
    });

    // Spec 022, REQ-13; Spec 022, REQ-15
    const siblingJobs = await this.jobsBySourceId(siblings.map((sibling) => sibling.id));
    const alreadyWon = siblings.some((sibling) =>
      isRaceWinner(sibling.status, siblingJobs.get(sibling.id)?.jobs ?? []),
    );
    if (alreadyWon) {
      console.log(`[torrentCompleted] resolveRace: mediaSource ${mediaSourceId} superseded, the target already has a winner`);
      return `ignorado: mediaSource ${mediaSourceId} superado por otro source de este target`;
    }

    const losers = siblings.filter(
      (sibling) => sibling.status !== 'ERROR' && sibling.status !== 'READY' && sibling.status !== 'SCANNED',
    );

    let pausedCount = 0;
    for (const loser of losers) {
      if (loser.infoHash) {
        try {
          await this.qbittorrent.stop(loser.infoHash);
        } catch (err) {
          // Spec 022, NFR-6
          console.error(`[torrentCompleted] resolveRace: could not pause mediaSource ${loser.id} in the torrent client:`, err);
          continue;
        }
      }
      await this.prisma.mediaSource.update({ where: { id: loser.id }, data: { status: 'PAUSED' } });
      pausedCount++;
    }

    console.log(`[torrentCompleted] resolveRace: mediaSource ${mediaSourceId} won, ${pausedCount} sibling(s) paused`);
    return `ganador: mediaSource ${mediaSourceId}, ${pausedCount} pausado(s)`;
  }

  async handleTorrentCompleted(infoHash: string): Promise<string> {
    const mediaSource = await this.prisma.mediaSource.findUnique({
      where: { infoHash },
      include: { movie: true, episode: true },
    });

    if (!mediaSource) {
      console.log(`[torrentCompleted] ignored: ${infoHash} does not match any MediaSource`);
      return `ignorado: ${infoHash} no corresponde a ningún MediaSource`;
    }

    if (mediaSource.status === 'READY' || mediaSource.status === 'SCANNED') {
      console.log(
        `[torrentCompleted] already processed: mediaSource ${mediaSource.id} in state ${mediaSource.status}`,
      );
      return `ya procesado: mediaSource ${mediaSource.id} en estado ${mediaSource.status}`;
    }

    // Deliberately still runs before resolveRace below: resolveRace pauses
    // this source's *siblings*, and an ERROR source's late completion must
    // never pause whatever superseded it.
    if (mediaSource.status === 'ERROR') {
      console.log(
        `[torrentCompleted] ignored: mediaSource ${mediaSource.id} is in ERROR (replaced)`,
      );
      return `ignorado: mediaSource ${mediaSource.id} está en ERROR (reemplazado)`;
    }

    if (!mediaSource.downloadPath) {
      const errorMessage = MESSAGES_EN[ERROR_KEYS.SOURCE_NO_DOWNLOAD_PATH];
      await this.prisma.mediaSource.update({
        where: { id: mediaSource.id },
        data: {
          status: 'ERROR',
          errorMessage,
          errorKey: ERROR_KEYS.SOURCE_NO_DOWNLOAD_PATH,
          errorParams: null,
        },
      });
      console.error(`[torrentCompleted] mediaSource ${mediaSource.id}: ${errorMessage}`);
      return `error: mediaSource ${mediaSource.id} sin downloadPath, marcado ERROR`;
    }

    // Spec 022, REQ-12; Spec 022, REQ-13
    const raceResult = await this.resolveRace(mediaSource.id);
    if (raceResult.startsWith('ignorado')) {
      return raceResult;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.mediaSource.update({
        where: { id: mediaSource.id },
        data: { status: 'READY' }, // READY = "Archivos disponibles en disco"
      });

      if (mediaSource.movie) {
        await tx.movie.update({
          where: { id: mediaSource.movie.id },
          data: { status: 'ENCODING' },
        });
      }

      if (mediaSource.episode) {
        await tx.episode.update({
          where: { id: mediaSource.episode.id },
          data: { status: 'ENCODING' },
        });
      }
    });

    await this.queue.addSourceReady({ mediaSourceId: mediaSource.id });

    console.log(`[torrentCompleted] encolado: mediaSource ${mediaSource.id}`);
    return `encolado: mediaSource ${mediaSource.id}`;
  }
}
