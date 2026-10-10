import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaService } from '@/prisma/prisma.service';
import { parseMagnet } from '@/clients/torrent/magnet';
import { sanitizeTag } from '@/clients/torrent/tags';
import { TorrentCategory } from '@/clients/torrent/client';
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
import { AttachSourceService } from '@/acquisition/attach-source.service';
import { AttachTarget } from '@/acquisition/attach-target';
import { TitleStatusService } from '@/title-status/title-status.service';

// Spec 022, REQ-3; Spec 022, REQ-2
function seasonTags(season: { seasonNumber: number; show: { id: number; title: string } }): string[] {
  return [sanitizeTag(season.show.title, season.show.id), `Season ${season.seasonNumber}`];
}

type SeasonWithShow = { id: number; seasonNumber: number; show: { id: number; title: string } };

// Spec 088, REQ-1 REQ-10
@Injectable()
export class SeasonsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly downloadsService: DownloadsService,
    private readonly settings: SettingsService,
    private readonly mediaRoots: MediaRootsService,
    private readonly queue: ProcessQueueService,
    private readonly sessions: SessionService,
    private readonly uploads: UploadsService,
    private readonly attachSource: AttachSourceService,
    private readonly titleStatus: TitleStatusService,
  ) {}

  async findOneFromDb(id: number, userId: string) {
    return this.prisma.season.findFirst({
      where: { id, show: { users: { some: { userId } } } },
      include: { show: true },
    });
  }

  private buildAttachTarget(seasonId: number): AttachTarget<SeasonWithShow> {
    return {
      column: 'seasonId',

      resolve: async (userId: string) => {
        const season = await this.findOneFromDb(seasonId, userId);
        if (!season) throw i18nError.notFound(ERROR_KEYS.SEASON_NOT_FOUND, { id: seasonId });
        return season;
      },

      // Spec 022, REQ-7 REQ-6; Spec 087, REQ-2
      refuse: async (target, force) => {
        if (force) return;
        const hasCompletedEpisode =
          (await this.prisma.episode.count({ where: { seasonId: target.id, status: 'COMPLETED' } })) > 0;
        if (hasCompletedEpisode || (await this.downloadsService.hasDeliveredSource({ seasonId: target.id }))) {
          throw i18nError.conflict(ERROR_KEYS.SEASON_ALREADY_COMPLETED);
        }
      },

      labels: (target) => ({ tags: seasonTags(target), category: 'show' as TorrentCategory }),
    };
  }

  async addTorrentToSeason(
    seasonId: number,
    input: { infoHash: string | null; urls: string[]; releaseTitle: string | null; force: boolean },
    userId: string,
  ) {
    // Spec 037, REQ-4
    const infoHash = input.infoHash ?? (await resolveInfoHash(input.urls));

    await this.attachSource.attach(
      this.buildAttachTarget(seasonId),
      { kind: 'TORRENT_SEARCH' as SourceKind, ...input, infoHash },
      userId,
    );

    // Spec 089, REQ-13
    await this.titleStatus.recomputeSeason(seasonId);

    return this.findSeasonWithEpisodes(seasonId);
  }

  async addMagnetToSeason(seasonId: number, input: { magnet: string; force: boolean }, userId: string) {
    // Spec 018, T010
    const parsed = parseMagnet(input.magnet);

    await this.attachSource.attach(
      this.buildAttachTarget(seasonId),
      {
        kind: 'TORRENT_FILE' as SourceKind,
        infoHash: parsed.infoHash,
        urls: [input.magnet],
        releaseTitle: parsed.displayName,
        force: input.force,
      },
      userId,
    );

    // Spec 089, REQ-13
    await this.titleStatus.recomputeSeason(seasonId);

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

    // Spec 089, REQ-13
    await this.titleStatus.recomputeSeason(seasonId);

    return { mediaSourceId: mediaSource.id, seasonId };
  }

  // Closes an upload session: the one place a season upload is handed to the
  // scan. Mirrors handleTorrentCompleted's season tail — race, READY, enqueue —
  // and writes no episode status literal (a season source has no episode of
  // its own); the season recompute below is a notification, not a write.
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

    // Spec 089, REQ-13
    await this.titleStatus.recomputeSeason(seasonId);

    return this.findSeasonWithEpisodes(seasonId);
  }

  private findSeasonWithEpisodes(seasonId: number) {
    return this.prisma.season.findUniqueOrThrow({
      where: { id: seasonId },
      include: { episodes: { orderBy: { episodeNumber: 'asc' } } },
    });
  }
}
