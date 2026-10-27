import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { i18nError } from '@/i18n/i18n-error';
import { ERROR_KEYS } from '@/i18n/error-keys';
import { LibraryLocationService } from '@/library-location/library-location.service';
import { LibraryProbeQueueService } from '@/queue/library-probe-queue.service';
import { POSSESSION_WHERE } from '@/pipeline-status/pipeline-status';
import { resolveSidecarLanguages } from '@/subtitle-search/sidecar-languages';
import { LibraryProbeTarget } from './dto/library-probe-target.input';
import { LibraryProbeDetails } from './entities/library-probe-details.entity';

type Resolved =
  | { kind: 'movie'; id: number }
  | { kind: 'episode'; id: number };

const unique = (codes: string[]) => [
  ...new Set(codes.map((code) => code.toLowerCase())),
];

// Spec 108, REQ-2 REQ-3 REQ-5
@Injectable()
export class LibraryProbeService implements OnApplicationBootstrap {
  private readonly logger = new Logger(LibraryProbeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly location: LibraryLocationService,
    private readonly queue: LibraryProbeQueueService,
  ) {}

  onApplicationBootstrap() {
    void this.backfill().catch((err) =>
      this.logger.warn(`library-probe backfill failed: ${String(err)}`),
    );
  }

  private resolveTarget(target: LibraryProbeTarget): Resolved {
    const hasMovie = target.movieId !== undefined && target.movieId !== null;
    const hasEpisode =
      target.episodeId !== undefined && target.episodeId !== null;
    if (hasMovie === hasEpisode) {
      throw i18nError.badRequest(ERROR_KEYS.LIBRARY_PROBE_INVALID_TARGET);
    }
    return hasMovie
      ? { kind: 'movie', id: target.movieId as number }
      : { kind: 'episode', id: target.episodeId as number };
  }

  // Spec 108, REQ-2
  async details(target: LibraryProbeTarget): Promise<LibraryProbeDetails> {
    const resolved = this.resolveTarget(target);

    let filePath: string | null;
    let present: boolean;
    let locate: Parameters<LibraryLocationService['locate']>[0];

    if (resolved.kind === 'movie') {
      const movie = await this.prisma.movie.findUnique({
        where: { id: resolved.id },
        select: { filePath: true, mediaServerPresentAt: true, tmdbId: true },
      });
      if (!movie) throw i18nError.notFound(ERROR_KEYS.LIBRARY_PROBE_NOT_FOUND);
      filePath = movie.filePath;
      present = movie.mediaServerPresentAt !== null;
      locate = { kind: 'movie', tmdbId: movie.tmdbId };
    } else {
      const episode = await this.prisma.episode.findUnique({
        where: { id: resolved.id },
        select: {
          filePath: true,
          mediaServerPresentAt: true,
          episodeNumber: true,
          season: {
            select: { seasonNumber: true, show: { select: { tmdbId: true } } },
          },
        },
      });
      if (!episode) throw i18nError.notFound(ERROR_KEYS.LIBRARY_PROBE_NOT_FOUND);
      filePath = episode.filePath;
      present = episode.mediaServerPresentAt !== null;
      locate = {
        kind: 'episode',
        tmdbId: episode.season.show.tmdbId,
        seasonNumber: episode.season.seasonNumber,
        episodeNumber: episode.episodeNumber,
      };
    }

    if (filePath) return { filePath };
    if (!present) throw i18nError.notFound(ERROR_KEYS.LIBRARY_PROBE_NOT_FOUND);

    const located = await this.location.locate(locate);
    if ('path' in located) return { filePath: located.path };
    if (located.reason === 'unavailable') {
      throw i18nError.serviceUnavailable(
        ERROR_KEYS.LIBRARY_PROBE_MEDIA_SERVER_UNAVAILABLE,
      );
    }
    throw i18nError.notFound(ERROR_KEYS.LIBRARY_PROBE_NOT_FOUND);
  }

  // Spec 108, REQ-5
  async completed(
    target: LibraryProbeTarget,
    filePath: string,
    audioLanguagesIso3: string[],
    embeddedSubtitleLanguagesIso3: string[],
    sidecarLanguageTags: string[],
  ): Promise<boolean> {
    const resolved = this.resolveTarget(target);

    const current =
      resolved.kind === 'movie'
        ? await this.prisma.movie.findUnique({
            where: { id: resolved.id },
            select: { filePath: true },
          })
        : await this.prisma.episode.findUnique({
            where: { id: resolved.id },
            select: { filePath: true },
          });
    if (!current) return false;

    const languages =
      sidecarLanguageTags.length > 0
        ? await this.prisma.language.findMany({
            select: { tag: true, iso2: true, iso3: true },
          })
        : [];
    const data = {
      fileAudioLanguages: unique(audioLanguagesIso3),
      fileSubtitleLanguages: unique([
        ...embeddedSubtitleLanguagesIso3,
        ...resolveSidecarLanguages(sidecarLanguageTags, languages),
      ]),
      tracksReadAt: new Date(),
    };
    const where = {
      id: resolved.id,
      OR: [
        { filePath },
        ...(current.filePath === null
          ? [{ filePath: null, mediaServerPresentAt: { not: null } }]
          : []),
      ],
    };

    const result =
      resolved.kind === 'movie'
        ? await this.prisma.movie.updateMany({ where, data })
        : await this.prisma.episode.updateMany({ where, data });
    return result.count === 1;
  }

  // Spec 108, REQ-3
  async backfill(): Promise<void> {
    const where = { tracksReadAt: null, ...POSSESSION_WHERE };
    const movies = await this.prisma.movie.findMany({
      where,
      select: { id: true },
    });
    for (const { id } of movies) await this.queue.request({ movieId: id });
    const episodes = await this.prisma.episode.findMany({
      where,
      select: { id: true },
    });
    for (const { id } of episodes) await this.queue.request({ episodeId: id });
  }
}
