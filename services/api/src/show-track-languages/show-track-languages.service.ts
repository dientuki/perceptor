import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { intersectEpisodeLanguages } from './intersect';

const toColumn = (codes: string[] | null) =>
  codes === null ? Prisma.DbNull : codes;

@Injectable()
export class ShowTrackLanguagesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ShowTrackLanguagesService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Spec 117, REQ-7
  async recompute(showId: number): Promise<void> {
    try {
      const episodes = await this.prisma.episode.findMany({
        where: { season: { showId } },
        select: {
          tracksReadAt: true,
          fileAudioLanguages: true,
          fileSubtitleLanguages: true,
          season: { select: { seasonNumber: true } },
        },
      });
      const { audio, subtitles } = intersectEpisodeLanguages(
        episodes.map((e) => ({
          seasonNumber: e.season.seasonNumber,
          tracksReadAt: e.tracksReadAt,
          fileAudioLanguages: e.fileAudioLanguages,
          fileSubtitleLanguages: e.fileSubtitleLanguages,
        })),
      );
      await this.prisma.show.update({
        where: { id: showId },
        data: {
          fileAudioLanguages: toColumn(audio),
          fileSubtitleLanguages: toColumn(subtitles),
        },
      });
    } catch (err) {
      this.logger.warn(
        `show ${showId} track languages recompute failed: ${String(err)}`,
      );
    }
  }

  // Spec 117, NFR-5
  onApplicationBootstrap() {
    void this.backfill().catch((err) =>
      this.logger.warn(`show track languages backfill failed: ${String(err)}`),
    );
  }

  async backfill(): Promise<void> {
    const shows = await this.prisma.show.findMany({ select: { id: true } });
    for (const { id } of shows) {
      await this.recompute(id);
    }
  }
}
