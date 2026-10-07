import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { parseMagnet } from '@/clients/torrent/magnet';
import { sanitizeTag } from '@/clients/torrent/tags';
import { resolveInfoHash } from '@/clients/indexer/resolve-info-hash';
import { i18nError } from '@/i18n/i18n-error';
import { ERROR_KEYS } from '@/i18n/error-keys';
import { DownloadsService } from '@/downloads/downloads.service';
import { AttachSourceService } from '@/acquisition/attach-source.service';
import { AttachTarget } from '@/acquisition/attach-target';
import { TitleStatusService } from '@/title-status/title-status.service';

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

interface EpisodeTarget {
  id: number;
  status: string;
  episodeNumber: number;
  season: { seasonNumber: number; show: { id: number; title: string } };
}

@Injectable()
export class EpisodesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly downloadsService: DownloadsService,
    private readonly attachSourceService: AttachSourceService,
    private readonly titleStatusService: TitleStatusService,
  ) {}

  async findOneFromDb(id: number, userId: string) {
    return this.prisma.episode.findFirst({
      where: { id, season: { show: { users: { some: { userId } } } } },
      include: { season: { include: { show: true } } },
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

  // Spec 088, REQ-1 REQ-8 REQ-10

  // Builds this target's AttachTarget descriptor — ownership lookup, the
  // COMPLETED/delivered refusal, the tag list and the `episodeId` column —
  // and hands it to the one shared attach body. Everything else (infoHash
  // resolution, the conflict scope, the no-op/reactivation branches,
  // add-before-write, demote-on-force) lives in AttachSourceService now.
  private buildTarget(episodeId: number): AttachTarget<EpisodeTarget> {
    return {
      resolve: async (userId: string) => {
        const episode = await this.findOneFromDb(episodeId, userId);
        if (!episode) throw i18nError.notFound(ERROR_KEYS.EPISODE_NOT_FOUND, { id: episodeId });
        return episode;
      },

      // Spec 087, REQ-2
      refuse: async (episode, force) => {
        const alreadyComplete =
          episode.status === 'COMPLETED' ||
          (await this.downloadsService.hasDeliveredSource({ episodeId: episode.id }));
        if (alreadyComplete && !force) {
          throw i18nError.conflict(ERROR_KEYS.EPISODE_ALREADY_COMPLETED);
        }
      },

      labels: (episode) => ({ tags: episodeTags(episode), category: 'show' }),
      column: 'episodeId',
    };
  }

  private async attachTorrentSource(
    episodeId: number,
    input: { kind: 'TORRENT_SEARCH' | 'TORRENT_FILE'; infoHash: string; urls: string[]; releaseTitle: string | null; force: boolean },
    userId: string,
  ) {
    const outcome = await this.attachSourceService.attach(this.buildTarget(episodeId), input, userId);

    if (outcome === 'ATTACHED') {
      await this.titleStatusService.recomputeEpisode(episodeId);
    }

    return this.prisma.episode.findUniqueOrThrow({ where: { id: episodeId } });
  }
}
