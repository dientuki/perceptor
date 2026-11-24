import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { ERROR_KEYS, ErrorKey } from '@/i18n/error-keys';
import { i18nError } from '@/i18n/i18n-error';
import { LibraryLocationService } from '@/library-location/library-location.service';
import {
  StagedTrackInput,
  SubtitleEmbedService,
  TargetRef,
} from '@/subtitle-embed/subtitle-embed.service';
import { SubtitleUploadStaging } from '@/subtitle-embed/upload-staging';
import { SubtitleEmbed } from '@/subtitle-embed/entities/subtitle-embed.entity';
import { NON_TERMINAL_SUBTITLE_SEARCH_STATUSES } from '@/subtitle-search/non-terminal';
import { decodeUpload } from './decode-upload';
import { SubtitleUploadInput } from './dto/subtitle-upload.input';

// Spec 124, REQ-4
const MAX_FILES = 8;

// Spec 124, REQ-6
const MAX_OFFSET_MS = 600_000;

type UploadTarget = {
  tmdbId: number;
  filePath: string | null;
  mediaServerPresentAt: Date | null;
  fileSubtitleLanguages: unknown;
  seasonNumber?: number;
  episodeNumber?: number;
};

// Spec 124, REQ-4
function isBareSrtName(fileName: string): boolean {
  return (
    fileName.toLowerCase().endsWith('.srt') &&
    fileName.length > '.srt'.length &&
    !fileName.includes('/') &&
    !fileName.includes('\\') &&
    !fileName.includes('..') &&
    !fileName.includes('\0')
  );
}

// Spec 124, REQ-1 REQ-2 REQ-4 REQ-6 REQ-8 REQ-9 REQ-10 REQ-11 REQ-12
@Injectable()
export class SubtitleUploadService {
  private readonly logger = new Logger(SubtitleUploadService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embed: SubtitleEmbedService,
    private readonly staging: SubtitleUploadStaging,
    private readonly location: LibraryLocationService,
  ) {}

  // Spec 124, REQ-2 REQ-4 REQ-6 REQ-9 REQ-10 REQ-11 REQ-12
  async upload(
    ref: TargetRef,
    inputs: SubtitleUploadInput[],
    userId: string,
  ): Promise<SubtitleEmbed> {
    const target = await this.resolveOwnedTarget(ref, userId);

    if (inputs.length === 0) {
      throw i18nError.badRequest(ERROR_KEYS.SUBTITLE_EMBED_EMPTY_SELECTION);
    }
    if (inputs.length > MAX_FILES) {
      throw i18nError.badRequest(ERROR_KEYS.SUBTITLE_EMBED_UPLOAD_TOO_MANY);
    }
    if (inputs.some((input) => !isBareSrtName(input.fileName))) {
      throw i18nError.badRequest(ERROR_KEYS.SUBTITLE_EMBED_UPLOAD_NOT_SRT);
    }
    if (new Set(inputs.map((input) => input.fileName)).size !== inputs.length) {
      throw i18nError.badRequest(ERROR_KEYS.SUBTITLE_EMBED_DUPLICATE_SUBTITLE);
    }
    if (inputs.filter((input) => input.isDefault).length > 1) {
      throw i18nError.badRequest(ERROR_KEYS.SUBTITLE_EMBED_MULTIPLE_DEFAULTS);
    }

    const languages = await this.resolveLanguages(inputs);

    for (const input of inputs) {
      if (
        !input.autoOffset &&
        (!Number.isInteger(input.offsetMs) ||
          Math.abs(input.offsetMs) > MAX_OFFSET_MS)
      ) {
        throw i18nError.badRequest(
          ERROR_KEYS.SUBTITLE_EMBED_OFFSET_OUT_OF_RANGE,
        );
      }
    }

    if (inputs.some((input) => input.replace && input.isForced)) {
      throw i18nError.badRequest(ERROR_KEYS.SUBTITLE_EMBED_REPLACE_FORCED);
    }

    const replaceIso3 = this.validateReplace(inputs, languages, target);

    const decoded: Buffer[] = [];
    for (const input of inputs) {
      const result = decodeUpload(input.contentBase64);
      if (!result.ok) {
        throw i18nError.badRequest(result.errorKey as ErrorKey);
      }
      decoded.push(result.bytes);
    }

    const mkvPath = await this.resolveMkvPath(ref, target, userId);

    await this.assertNoActiveSearch(ref);

    const tracks: StagedTrackInput[] = inputs.map((input) => ({
      languageIso3: languages.get(input.languageTag)!.iso3,
      variantTag: input.languageTag,
      fileName: input.fileName,
      offsetMs: input.autoOffset ? 0 : input.offsetMs,
      autoOffset: input.autoOffset,
      isDefault: input.isDefault,
      isForced: input.isForced,
      provenance: input.fileName,
      provider: 'user',
    }));

    return this.embed.embedStaged(
      ref,
      tracks,
      mkvPath,
      replaceIso3,
      (embedId) => this.stage(embedId, decoded),
    );
  }

  // Spec 124, REQ-12
  private async stage(embedId: number, files: Buffer[]): Promise<string[]> {
    try {
      const paths: string[] = [];
      for (const [index, bytes] of files.entries()) {
        paths.push(await this.staging.write(embedId, index, bytes));
      }
      return paths;
    } catch (error) {
      this.logger.warn(
        `Could not stage the upload of embed ${embedId}: ${String(error)}`,
      );
      throw i18nError.internalServerError(
        ERROR_KEYS.SUBTITLE_EMBED_UPLOAD_STAGING_FAILED,
      );
    }
  }

  // Spec 124, REQ-2
  private async resolveOwnedTarget(
    ref: TargetRef,
    userId: string,
  ): Promise<UploadTarget> {
    if (ref.kind === 'movie') {
      const movie = await this.prisma.movie.findFirst({
        where: { id: ref.id, users: { some: { userId } } },
        select: {
          tmdbId: true,
          filePath: true,
          mediaServerPresentAt: true,
          fileSubtitleLanguages: true,
        },
      });
      if (!movie) {
        throw i18nError.notFound(ERROR_KEYS.MOVIE_NOT_FOUND, { id: ref.id });
      }
      return movie;
    }

    const episode = await this.prisma.episode.findFirst({
      where: { id: ref.id, season: { show: { users: { some: { userId } } } } },
      select: {
        filePath: true,
        mediaServerPresentAt: true,
        fileSubtitleLanguages: true,
        episodeNumber: true,
        season: {
          select: { seasonNumber: true, show: { select: { tmdbId: true } } },
        },
      },
    });
    if (!episode) {
      throw i18nError.notFound(ERROR_KEYS.EPISODE_NOT_FOUND, { id: ref.id });
    }
    return {
      tmdbId: episode.season.show.tmdbId,
      filePath: episode.filePath,
      mediaServerPresentAt: episode.mediaServerPresentAt,
      fileSubtitleLanguages: episode.fileSubtitleLanguages,
      seasonNumber: episode.season.seasonNumber,
      episodeNumber: episode.episodeNumber,
    };
  }

  // Spec 124, REQ-6 REQ-7
  private async resolveLanguages(
    inputs: SubtitleUploadInput[],
  ): Promise<Map<string, { tag: string; iso3: string }>> {
    const tags = [...new Set(inputs.map((input) => input.languageTag))];
    const rows = await this.prisma.language.findMany({
      where: { tag: { in: tags } },
      select: { tag: true, iso3: true },
    });
    const byTag = new Map(rows.map((row) => [row.tag, row]));
    for (const tag of tags) {
      if (!byTag.has(tag)) {
        throw i18nError.badRequest(ERROR_KEYS.SUBTITLE_EMBED_UNKNOWN_LANGUAGE, {
          language: tag,
        });
      }
    }
    return byTag;
  }

  // Spec 124, REQ-9
  private validateReplace(
    inputs: SubtitleUploadInput[],
    languages: Map<string, { iso3: string }>,
    target: UploadTarget,
  ): string[] {
    const replace = [
      ...new Set(
        inputs
          .filter((input) => input.replace)
          .map((input) => languages.get(input.languageTag)!.iso3.toLowerCase()),
      ),
    ];
    if (replace.length === 0) return [];

    const held = new Set(
      Array.isArray(target.fileSubtitleLanguages)
        ? target.fileSubtitleLanguages.map((item) => String(item).toLowerCase())
        : [],
    );
    if (replace.some((iso3) => !held.has(iso3))) {
      throw i18nError.badRequest(
        ERROR_KEYS.SUBTITLE_SEARCH_REPLACE_LANGUAGE_NOT_PRESENT,
      );
    }
    return replace;
  }

  // Spec 124, REQ-10 REQ-11
  private async resolveMkvPath(
    ref: TargetRef,
    target: UploadTarget,
    userId: string,
  ): Promise<string> {
    if (target.filePath) {
      await this.embed.assertManualSearchPreflight(ref, userId);
      return target.filePath;
    }

    if (!target.mediaServerPresentAt) {
      await this.embed.assertManualSearchPreflight(ref, userId);
    }

    const located = await this.location.locate({
      kind: ref.kind,
      tmdbId: target.tmdbId,
      seasonNumber: target.seasonNumber,
      episodeNumber: target.episodeNumber,
    });
    if ('path' in located) {
      await this.embed.assertUsableMkv(located.path);
      await this.embed.assertManualSearchPreflight(ref, userId);
      return located.path;
    }
    if (located.reason === 'unavailable') {
      throw i18nError.serviceUnavailable(
        ERROR_KEYS.SUBTITLE_EMBED_MEDIA_SERVER_UNAVAILABLE,
      );
    }
    if (located.reason === 'outside_library') {
      throw i18nError.badRequest(ERROR_KEYS.SUBTITLE_EMBED_OUTSIDE_LIBRARY);
    }
    throw i18nError.badRequest(ERROR_KEYS.SUBTITLE_EMBED_NO_FILE);
  }

  // Spec 124, REQ-11
  private async assertNoActiveSearch(ref: TargetRef): Promise<void> {
    const column =
      ref.kind === 'movie' ? { movieId: ref.id } : { episodeId: ref.id };
    const running = await this.prisma.subtitleSearch.count({
      where: {
        ...column,
        status: { in: [...NON_TERMINAL_SUBTITLE_SEARCH_STATUSES] },
      },
    });
    if (running > 0) {
      throw i18nError.conflict(ERROR_KEYS.SUBTITLE_SEARCH_IN_PROGRESS);
    }
  }
}
