import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaService } from '@/prisma/prisma.service';
import { QbittorrentClient } from '@/clients/torrent/client';
import { parseMagnet } from '@/clients/torrent/magnet';
import { resolveInfoHash } from '@/clients/indexer/resolve-info-hash';
import { SourceKind } from '@prisma/client';
import { i18nError } from '@/i18n/i18n-error';
import { ERROR_KEYS } from '@/i18n/error-keys';
import { DownloadsService } from '@/downloads/downloads.service';
import { SettingsService } from '@/settings/settings.service';
import { MediaRootsService } from '@/media-roots/media-roots.service';
import { ProcessQueueService } from '@/queue/process-queue.service';
import { SessionService } from '@/uploads/session.service';
import { UploadsService } from '@/uploads/uploads.service';

// Spec 022, REQ-5
function sanitizeTag(title: string, fallbackId: number): string {
  const cleaned = title.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned || `id-${fallbackId}`;
}

// Spec 022, REQ-3; Spec 022, REQ-2
function seasonTags(season: { seasonNumber: number; show: { id: number; title: string } }): string[] {
  return [sanitizeTag(season.show.title, season.show.id), `Season ${season.seasonNumber}`];
}

// Structural twin of EpisodesService (episodes/episodes.service.ts), itself
// a structural twin of MoviesService — the third deliberate copy, not a
// shared helper, see 013-season-pack-processing's api/plan.md § Approach.
// One relation shallower than the episode version: ownership runs through
// season -> show -> UserShow, no episode hop in between. "Already
// downloading" is a query for a non-ERROR MediaSource against this seasonId
// (MediaSource.seasonId, not a unique column), so `force` means demoting
// every such row to ERROR *before* creating the replacement — same ordering
// guarantee as the episode/movie twins, for the same reason.
@Injectable()
export class SeasonsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly qbittorrent: QbittorrentClient,
    private readonly downloadsService: DownloadsService,
    private readonly settings: SettingsService,
    private readonly mediaRoots: MediaRootsService,
    private readonly queue: ProcessQueueService,
    private readonly sessions: SessionService,
    private readonly uploads: UploadsService,
  ) {}

  async findOneFromDb(id: number, userId: string) {
    return this.prisma.season.findFirst({
      where: { id, show: { users: { some: { userId } } } },
      include: { show: true },
    });
  }

  async addTorrentToSeason(
    seasonId: number,
    input: { infoHash: string | null; urls: string[]; releaseTitle: string | null; force: boolean },
    userId: string,
  ) {
    const infoHash = input.infoHash ?? (await resolveInfoHash(input.urls));
    return this.attachTorrentSource(seasonId, { kind: 'TORRENT_SEARCH', ...input, infoHash }, userId);
  }

  async addMagnetToSeason(seasonId: number, input: { magnet: string; force: boolean }, userId: string) {
    // Spec 018, T010
    const parsed = parseMagnet(input.magnet);

    return this.attachTorrentSource(
      seasonId,
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

  // Structural twin of EpisodesService.attachTorrentSource, deliberately not
  // extracted into a shared helper — see ../../../docs/spec/features/
  // 013-season-pack-processing/plan.md § Approach for why. The one shape
  // difference: the created/updated MediaSource carries seasonId instead of
  // episodeId, and the conflict/demotion queries are seasonId-scoped.
  private async attachTorrentSource(
    seasonId: number,
    input: { kind: SourceKind; infoHash: string; urls: string[]; releaseTitle: string | null; force: boolean },
    userId: string,
  ) {
    const season = await this.findOneFromDb(seasonId, userId);
    if (!season) throw i18nError.notFound(ERROR_KEYS.SEASON_NOT_FOUND, { id: seasonId });

    // Symmetric with the checks MoviesService/EpisodesService.attachTorrentSource
    // already do: an infoHash already owned by a movie, an episode, or a
    // *different* season must not be silently re-pointed at this one.
    const existingSource = await this.prisma.mediaSource.findUnique({
      where: { infoHash: input.infoHash },
      include: {
        movie: true,
        episode: { include: { season: { include: { show: true } } } },
        season: { include: { show: true } },
      },
    });

    if (existingSource && existingSource.movie) {
      throw i18nError.conflict(ERROR_KEYS.MAGNET_ALREADY_ATTACHED, {
        title: existingSource.movie.title,
      });
    }

    if (existingSource && existingSource.episode) {
      throw i18nError.conflict(ERROR_KEYS.MAGNET_ALREADY_ATTACHED, {
        title: this.episodeDisplayTitle(existingSource.episode),
      });
    }

    if (existingSource && existingSource.season && existingSource.season.id !== seasonId) {
      throw i18nError.conflict(ERROR_KEYS.MAGNET_ALREADY_ATTACHED_SEASON, {
        show: existingSource.season.show.title,
        number: existingSource.season.seasonNumber,
      });
    }

    const sameTarget = existingSource?.season?.id === seasonId;

    if (existingSource && sameTarget && existingSource.status !== 'ERROR') {
      return this.findSeasonWithEpisodes(seasonId);
    }

    const activeSource = await this.prisma.mediaSource.findFirst({
      where: { seasonId, status: { not: 'ERROR' } },
    });

    // Spec 022, REQ-7 REQ-6; Spec 087, REQ-2
    if (!input.force) {
      const hasCompletedEpisode =
        (await this.prisma.episode.count({ where: { seasonId, status: 'COMPLETED' } })) > 0;
      if (hasCompletedEpisode || (await this.downloadsService.hasDeliveredSource({ seasonId }))) {
        throw i18nError.conflict(ERROR_KEYS.SEASON_ALREADY_COMPLETED);
      }
    }

    let reactivated = false;
    if (existingSource && sameTarget) {
      const hash = input.infoHash.toLowerCase();
      const held = (await this.qbittorrent.info()).find(
        (torrent) => torrent.hash.toLowerCase() === hash,
      );

      if (held) {
        const finished = held.state === 'READY';
        if (!finished) await this.qbittorrent.start(hash);

        if (activeSource && input.force) {
          // Spec 087, REQ-3 REQ-4
          await this.downloadsService.demoteDeliveredSources({ seasonId }, `season-${seasonId}-reactivate`);
        }

        await this.prisma.mediaSource.update({
          where: { id: existingSource.id },
          data: {
            status: 'QUEUED',
            errorMessage: null,
            errorKey: null,
            errorParams: null,
          },
        });
        if (finished) await this.downloadsService.handleTorrentCompleted(hash);

        reactivated = true;
      }
    }

    if (reactivated) return this.findSeasonWithEpisodes(seasonId);

    const downloadPath = await this.qbittorrent.add(input.urls, seasonTags(season), 'show');

    // Demote *before* creating the replacement, and only after qBittorrent
    // has accepted the new torrent — so a rejected add() leaves the
    // previously active source untouched.

    // Spec 087, REQ-3 REQ-4
    if (activeSource && input.force) {
      await this.downloadsService.demoteDeliveredSources({ seasonId }, `season-${seasonId}-attach`);
    }

    const mediaSource = existingSource
      ? await this.prisma.mediaSource.update({
          where: { id: existingSource.id },
          data: {
            kind: input.kind,
            status: 'QUEUED',
            downloadUrl: input.urls[0] ?? null,
            releaseTitle: input.releaseTitle,
            downloadPath,
            errorMessage: null,
            errorKey: null,
            errorParams: null,
            seasonId,
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
            seasonId,
          },
        });

    // Season.episodes is non-null on the entity (Season.episodes: [Episode!]!)
    // — a bare row here would fail the mutation *after* the torrent was
    // already accepted, see api/plan.md's "Season returned without its
    // episodes" risk.
    return this.findSeasonWithEpisodes(seasonId);
  }

  async startSeasonUpload(seasonId: number, force: boolean, userId: string) {
    const season = await this.findOneFromDb(seasonId, userId);
    if (!season) throw i18nError.notFound(ERROR_KEYS.SEASON_NOT_FOUND, { id: seasonId });

    // Spec 087, REQ-2
    if (!force) {
      const hasCompletedEpisode =
        (await this.prisma.episode.count({ where: { seasonId, status: 'COMPLETED' } })) > 0;
      if (hasCompletedEpisode || (await this.downloadsService.hasDeliveredSource({ seasonId }))) {
        throw i18nError.conflict(ERROR_KEYS.SEASON_ALREADY_COMPLETED);
      }
    }

    const config = await this.settings.getMap();
    const downloadsBase = await this.mediaRoots.resolveFromRoot('downloads', config.path_downloads ?? '.');
    const downloadPath = join(downloadsBase, 'imports', randomUUID());
    await mkdir(downloadPath, { recursive: true });

    // Spec 087, REQ-3 REQ-4
    if (force) {
      await this.downloadsService.demoteDeliveredSources({ seasonId }, `season-${seasonId}-upload`);
    }

    const mediaSource = await this.prisma.mediaSource.create({
      data: { kind: 'LOCAL_FOLDER', status: 'PENDING', seasonId, downloadPath },
    });

    return { mediaSourceId: mediaSource.id, seasonId };
  }

  // Closes an upload session: the one place a season upload is handed to the
  // scan. Mirrors handleTorrentCompleted's season tail — race, READY, enqueue —
  // and writes no episode status (a season source has no episode of its own).
  async finishSeasonUpload(mediaSourceId: number, userId: string) {
    const session = await this.sessions.findOpenSeasonSession(mediaSourceId, userId);
    if (!session || !session.seasonId || !session.downloadPath) {
      throw i18nError.conflict(ERROR_KEYS.UPLOAD_SESSION_NOT_OPEN);
    }
    const seasonId = session.seasonId;

    const entries = await readdir(session.downloadPath, { withFileTypes: true }).catch((): Dirent[] => []);
    if (!entries.some((entry) => entry.isFile())) {
      throw i18nError.conflict(ERROR_KEYS.UPLOAD_SESSION_EMPTY);
    }

    await this.uploads.demoteSupersededSources({ seasonId }, `session-${mediaSourceId}`);

    // Spec 087, REQ-5
    const raceResult = await this.downloadsService.resolveRace(mediaSourceId);
    if (raceResult.outcome !== 'WON') {
      throw i18nError.conflict(ERROR_KEYS.UPLOAD_SUPERSEDED);
    }

    // Atomic PENDING -> READY: of two concurrent closes only one flips the
    // row, and only that one enqueues the scan.
    const { count } = await this.prisma.mediaSource.updateMany({
      where: { id: mediaSourceId, status: 'PENDING' },
      data: { status: 'READY' },
    });
    if (count === 0) throw i18nError.conflict(ERROR_KEYS.UPLOAD_SESSION_NOT_OPEN);

    await this.queue.addSourceReady({ mediaSourceId });

    return this.findSeasonWithEpisodes(seasonId);
  }

  private findSeasonWithEpisodes(seasonId: number) {
    return this.prisma.season.findUniqueOrThrow({
      where: { id: seasonId },
      include: { episodes: { orderBy: { episodeNumber: 'asc' } } },
    });
  }

  // Zero-padded "<Show> S04E01" rendering, matching EpisodesService's own
  // copy. Kept local rather than shared — see that file's comment.
  private episodeDisplayTitle(episode: {
    episodeNumber: number;
    season: { seasonNumber: number; show: { title: string } };
  }): string {
    const season = String(episode.season.seasonNumber).padStart(2, '0');
    const ep = String(episode.episodeNumber).padStart(2, '0');
    return `${episode.season.show.title} S${season}E${ep}`;
  }
}
