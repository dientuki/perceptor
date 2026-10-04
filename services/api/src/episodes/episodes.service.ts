import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { QbittorrentClient } from '@/clients/torrent/client';
import { parseMagnet } from '@/clients/torrent/magnet';
import { resolveInfoHash } from '@/clients/indexer/resolve-info-hash';
import { SourceKind } from '@prisma/client';
import { i18nError } from '@/i18n/i18n-error';
import { ERROR_KEYS } from '@/i18n/error-keys';
import { MESSAGES_EN } from '@/i18n/messages.en';
import { DownloadsService } from '@/downloads/downloads.service';

// Spec 022, REQ-5; Spec 022, REQ-4
function sanitizeTag(title: string, fallbackId: number): string {
  const cleaned = title.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned || `id-${fallbackId}`;
}

// Spec 022, REQ-2
function episodeTags(episode: {
  episodeNumber: number;
  season: { seasonNumber: number; show: { id: number; title: string } };
}): string[] {
  return [
    sanitizeTag(episode.season.show.title, episode.season.show.id),
    `Season ${episode.season.seasonNumber}`,
    `Episode ${episode.episodeNumber}`,
  ];
}

// Structural twin of MoviesService.findOneFromDb, one relation deeper:
// ownership runs through episode -> season -> show -> UserShow rather than
// a direct join, but the rule is identical — null covers both "does not
// exist" and "exists but belongs to someone else's show", indistinguishably
// (see spec.md's 010-episode-acquisition § Errors).
@Injectable()
export class EpisodesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly qbittorrent: QbittorrentClient,
    private readonly downloadsService: DownloadsService,
  ) {}

  async findOneFromDb(id: number, userId: string) {
    return this.prisma.episode.findFirst({
      where: { id, season: { show: { users: { some: { userId } } } } },
      include: { season: { include: { show: true } } },
    });
  }

  // Spec 027, REQ-6
  async findActiveSource(episodeId: number) {
    return this.prisma.mediaSource.findFirst({
      where: { episodeId, status: { not: 'ERROR' } },
    });
  }

  async addTorrentToEpisode(
    episodeId: number,
    input: { infoHash: string | null; urls: string[]; releaseTitle: string | null; force: boolean },
    userId: string,
  ) {
    // Spec 037, REQ-4
    const infoHash = input.infoHash ?? (await resolveInfoHash(input.urls));
    return this.attachTorrentSource(episodeId, { kind: 'TORRENT_SEARCH', ...input, infoHash }, userId);
  }

  async addMagnetToEpisode(episodeId: number, input: { magnet: string; force: boolean }, userId: string) {
    // Spec 018, T010
    const parsed = parseMagnet(input.magnet);

    return this.attachTorrentSource(
      episodeId,
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

  // Spec 022, REQ-7
  private async attachTorrentSource(
    episodeId: number,
    input: { kind: SourceKind; infoHash: string; urls: string[]; releaseTitle: string | null; force: boolean },
    userId: string,
  ) {
    const episode = await this.findOneFromDb(episodeId, userId);
    if (!episode) throw i18nError.notFound(ERROR_KEYS.EPISODE_NOT_FOUND, { id: episodeId });

    const activeSource = await this.findActiveSource(episodeId);

    // Symmetric with the check MoviesService.attachTorrentSource now does:
    // an infoHash already owned by a movie, or by a *different* episode,
    // must not be silently re-pointed at this one.
    const existingSource = await this.prisma.mediaSource.findUnique({
      where: { infoHash: input.infoHash },
      include: { movie: true },
    });

    if (existingSource && existingSource.movie) {
      throw i18nError.conflict(ERROR_KEYS.MAGNET_ALREADY_ATTACHED, {
        title: existingSource.movie.title,
      });
    }

    if (existingSource && existingSource.episodeId && existingSource.episodeId !== episodeId) {
      throw i18nError.conflict(ERROR_KEYS.MAGNET_ALREADY_ATTACHED, {
        title: this.episodeDisplayTitle(episode),
      });
    }

    const sameTarget = existingSource?.episodeId === episodeId;

    if (existingSource && sameTarget && existingSource.status !== 'ERROR') {
      return this.prisma.episode.findUniqueOrThrow({ where: { id: episodeId } });
    }

    // Spec 022, REQ-7; Spec 022, REQ-6
    if (episode.status === 'COMPLETED' && !input.force) {
      throw i18nError.conflict(ERROR_KEYS.EPISODE_ALREADY_COMPLETED);
    }

    const demoteActive = async () => {
      if (!activeSource || !input.force) return;
      await this.prisma.mediaSource.updateMany({
        where: { episodeId, status: { not: 'ERROR' } },
        data: {
          status: 'ERROR',
          errorMessage: MESSAGES_EN[ERROR_KEYS.SOURCE_REPLACED],
          errorKey: ERROR_KEYS.SOURCE_REPLACED,
          errorParams: null,
        },
      });
    };

    if (existingSource && sameTarget) {
      const hash = input.infoHash.toLowerCase();
      const held = (await this.qbittorrent.info()).find((torrent) => torrent.hash.toLowerCase() === hash);

      if (held) {
        const finished = held.state === 'READY';
        if (!finished) await this.qbittorrent.start(hash);

        await demoteActive();
        await this.prisma.mediaSource.update({
          where: { id: existingSource.id },
          data: { status: 'QUEUED', errorMessage: null, errorKey: null, errorParams: null },
        });
        await this.prisma.episode.update({
          where: { id: episodeId },
          data: { status: 'DOWNLOADING' },
        });
        if (finished) await this.downloadsService.handleTorrentCompleted(hash);

        return this.prisma.episode.findUniqueOrThrow({ where: { id: episodeId } });
      }
    }

    const downloadPath = await this.qbittorrent.add(input.urls, episodeTags(episode), 'show');

    // Demote *before* creating the replacement, and only after qBittorrent
    // has accepted the new torrent — so a rejected add() leaves the
    // previously active source untouched.
    await demoteActive();

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
            episodeId,
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
            episodeId,
          },
        });

    await this.prisma.episode.update({
      where: { id: episodeId },
      data: { status: 'DOWNLOADING' },
    });

    return this.prisma.episode.findUniqueOrThrow({ where: { id: episodeId } });
  }

  // Zero-padded "<Show> S04E01" rendering, matching the prefill format
  // SearchTorrent.tsx builds on the web side. Kept local rather than shared
  // with MoviesService's own copy — see that file's comment.
  private episodeDisplayTitle(episode: {
    episodeNumber: number;
    season: { seasonNumber: number; show: { title: string } };
  }): string {
    const season = String(episode.season.seasonNumber).padStart(2, '0');
    const ep = String(episode.episodeNumber).padStart(2, '0');
    return `${episode.season.show.title} S${season}E${ep}`;
  }
}
