import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { TmdbClient } from '@/clients/tmdb/client';
import { MEDIA_TYPE } from '@/types/media';

export type ImdbTitleType = 'movie' | 'show';

// Spec 121, REQ-11
@Injectable()
export class ImdbIdsService {
  private readonly logger = new Logger(ImdbIdsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tmdb: TmdbClient,
  ) {}

  // Stamps imdbIdCheckedAt even for a null id: "TMDB answered, there is none"
  // is a stored answer, so it is never asked again.
  async record(
    type: ImdbTitleType,
    id: number,
    imdbId: string | null,
  ): Promise<void> {
    const data = { imdbId, imdbIdCheckedAt: new Date() };
    if (type === 'movie') {
      await this.prisma.movie.update({ where: { id }, data });
    } else {
      await this.prisma.show.update({ where: { id }, data });
    }
  }

  // Never throws: it also runs detached, where a throw is an unhandled rejection.
  async resolve(type: ImdbTitleType, id: number): Promise<string | null> {
    try {
      const row =
        type === 'movie'
          ? await this.prisma.movie.findUnique({
              where: { id },
              select: { tmdbId: true, imdbId: true, imdbIdCheckedAt: true },
            })
          : await this.prisma.show.findUnique({
              where: { id },
              select: { tmdbId: true, imdbId: true, imdbIdCheckedAt: true },
            });
      if (!row) return null;
      if (row.imdbIdCheckedAt !== null) return row.imdbId;

      const detail = await this.tmdb.details(
        type === 'movie' ? MEDIA_TYPE.MOVIE : MEDIA_TYPE.SHOW,
        row.tmdbId,
      );
      await this.record(type, id, detail.imdbId);
      return detail.imdbId;
    } catch (err) {
      this.logger.warn(
        `IMDb id lookup failed for ${type} ${id}: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
      return null;
    }
  }
}
