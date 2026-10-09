import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { QbittorrentClient } from '@/clients/torrent/client';
import { SourceKind } from '@prisma/client';
import { i18nError } from '@/i18n/i18n-error';
import { ERROR_KEYS } from '@/i18n/error-keys';
import { DownloadsService } from '@/downloads/downloads.service';
import { resolveInfoHash } from '@/clients/indexer/resolve-info-hash';
import { episodeDisplayTitle } from '@/episodes/episode-title';
import { AttachTarget } from './attach-target';

export type AttachInput = {
  kind: SourceKind;
  infoHash: string | null;
  urls: string[];
  releaseTitle: string | null;
  force: boolean;
};

// Spec 088, REQ-1
export type AttachOutcome = 'UNCHANGED' | 'ATTACHED';

type DeliveryTarget = { movieId: number } | { episodeId: number } | { seasonId: number };

function deliveryTargetFor<T extends { id: number }>(
  targetDef: AttachTarget<T>,
  target: T,
): DeliveryTarget {
  return { [targetDef.column]: target.id } as DeliveryTarget;
}

function columnDataFor<T extends { id: number }>(
  targetDef: AttachTarget<T>,
  target: T,
): { movieId?: number; episodeId?: number; seasonId?: number } {
  return { [targetDef.column]: target.id };
}

// Spec 037, REQ-4; Spec 087, REQ-3 REQ-4; Spec 088, REQ-1 REQ-2 REQ-8 REQ-9 REQ-10
@Injectable()
export class AttachSourceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly qbittorrent: QbittorrentClient,
    private readonly downloads: DownloadsService,
  ) {}

  async attach<T extends { id: number }>(
    targetDef: AttachTarget<T>,
    input: AttachInput,
    userId: string,
  ): Promise<AttachOutcome> {
    const target = await targetDef.resolve(userId);

    // Spec 037, REQ-4
    const infoHash = input.infoHash ?? (await resolveInfoHash(input.urls));

    const existingSource = await this.prisma.mediaSource.findUnique({
      where: { infoHash },
      include: {
        movie: true,
        episode: { include: { season: { include: { show: true } } } },
        season: { include: { show: true } },
      },
    });

    const sameTarget = existingSource
      ? existingSource[targetDef.column] === target.id
      : false;

    // Spec 088, REQ-2 REQ-3 REQ-4 REQ-9
    if (existingSource && !sameTarget) {
      if (existingSource.movie) {
        throw i18nError.conflict(ERROR_KEYS.MAGNET_ALREADY_ATTACHED, {
          title: existingSource.movie.title,
        });
      }
      if (existingSource.episode) {
        throw i18nError.conflict(ERROR_KEYS.MAGNET_ALREADY_ATTACHED, {
          title: episodeDisplayTitle(existingSource.episode),
        });
      }
      if (existingSource.season) {
        throw i18nError.conflict(ERROR_KEYS.MAGNET_ALREADY_ATTACHED_SEASON, {
          show: existingSource.season.show.title,
          number: existingSource.season.seasonNumber,
        });
      }
    }

    // Spec 090, REQ-6
    if (
      existingSource &&
      sameTarget &&
      existingSource.status !== 'ERROR' &&
      !existingSource.retiredAt
    ) {
      return 'UNCHANGED';
    }

    // Spec 087, REQ-2
    await targetDef.refuse(target, input.force);

    if (existingSource && sameTarget) {
      const hash = infoHash.toLowerCase();
      const held = (await this.qbittorrent.info()).find(
        (torrent) => torrent.hash.toLowerCase() === hash,
      );

      if (held) {
        const finished = held.state === 'READY';
        if (!finished) await this.qbittorrent.start(hash);

        // Spec 087, REQ-3 REQ-4
        if (input.force) {
          await this.downloads.demoteDeliveredSources(
            deliveryTargetFor(targetDef, target),
            `${targetDef.column}:${target.id} reactivation`,
          );
        }

        // Spec 090, NFR-3
        await this.prisma.mediaSource.update({
          where: { id: existingSource.id },
          data: {
            status: 'QUEUED',
            errorMessage: null,
            errorKey: null,
            errorParams: null,
            retiredAt: null,
          },
        });

        if (finished) await this.downloads.handleTorrentCompleted(hash);

        return 'ATTACHED';
      }
    }

    const { tags, category } = targetDef.labels(target);
    const downloadPath = await this.qbittorrent.add(input.urls, tags, category);

    // Spec 087, REQ-3 REQ-4
    if (input.force) {
      await this.downloads.demoteDeliveredSources(
        deliveryTargetFor(targetDef, target),
        `${targetDef.column}:${target.id} attach`,
      );
    }

    const columnData = columnDataFor(targetDef, target);

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
            errorKey: null,
            errorParams: null,
            retiredAt: null,
            ...columnData,
          },
        })
      : await this.prisma.mediaSource.create({
          data: {
            kind: input.kind,
            status: 'QUEUED',
            infoHash,
            downloadUrl: input.urls[0] ?? null,
            releaseTitle: input.releaseTitle,
            downloadPath,
            ...columnData,
          },
        });

    return 'ATTACHED';
  }
}
