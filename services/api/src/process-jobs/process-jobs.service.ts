import { Injectable } from '@nestjs/common';
import { LanguageTrackKind } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { QbittorrentClient } from '@/clients/torrent/client';
import { SettingsService } from '@/settings/settings.service';
import { MediaRootsService } from '@/media-roots/media-roots.service';
import { MediaServerService } from '@/media-server/media-server.service';
import { MediaCapabilitiesService } from '@/media/media-capabilities.service';
import { EncodeQueueService } from '@/queue/encode-queue.service';
import { ERROR_KEYS } from '@/i18n/error-keys';
import { i18nError } from '@/i18n/i18n-error';
import { MESSAGES_EN } from '@/i18n/messages.en';
import { EncodeJobDetails } from './entities/encode-job-details.entity';
import { ContentKind } from '@/media/entities/content-kind.enum';
import { resolveAllowedSubtitleFormats } from '@/settings/subtitle-formats';
import { COMPRESSION_RESOLUTIONS, DEFAULT_COMPRESSION_RESOLUTION } from '@/settings/settings.catalog';

// Spec 054, REQ-4
const RECOVERY_ALLOWANCE = 1;

@Injectable()
export class ProcessJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly torrentClient: QbittorrentClient,
    private readonly settings: SettingsService,
    private readonly mediaRoots: MediaRootsService,
    private readonly mediaServer: MediaServerService,
    private readonly mediaCapabilities: MediaCapabilitiesService,
    // Spec 054, T005
    private readonly encodeQueue: EncodeQueueService,
  ) {}

  async getEncodeJobDetails(id: number): Promise<EncodeJobDetails> {
    const processJob = await this.prisma.processJob.findUnique({
      where: { id },
      include: {
        sourceFile: { include: { mediaSource: true } },
        movie: true,
        episode: { include: { season: { include: { show: true } } } },
      },
    });

    if (!processJob) {
      throw i18nError.notFound(ERROR_KEYS.PROCESS_JOB_NOT_FOUND, { id });
    }

    const mediaSource = processJob.sourceFile.mediaSource;
    const settingsMap = await this.settings.getMap();
    // Spec 032, REQ-7
    const compressionEnabled = settingsMap['compression_enabled'] !== 'false';
    // Spec 058, REQ-4
    const storedResolution = settingsMap['compression_resolution'];
    const compressionResolution = (COMPRESSION_RESOLUTIONS as readonly string[]).includes(storedResolution)
      ? storedResolution
      : DEFAULT_COMPRESSION_RESOLUTION;
    const base = {
      id: processJob.id,
      status: processJob.status,
      inputFilePath: processJob.sourceFile.filePath,
      mediaSourceId: mediaSource.id,
      sourceKind: mediaSource.kind,
      infoHash: mediaSource.infoHash,
      downloadPath: mediaSource.downloadPath,
      downloadsRoot: await this.mediaRoots.resolveFromRoot('downloads', '.'),
      compressionEnabled,
      compressionResolution,
      allowedSubtitleFormats: resolveAllowedSubtitleFormats(settingsMap),
      libraryLayout: this.mediaServer.resolveLibraryLayout(settingsMap),
    };

    if (processJob.movie) {
      const { movie } = processJob;
      const original = await this.resolveOriginalLanguage(movie.originalLanguage);
      const {
        audioIso3Codes: allowedAudioLanguagesIso3,
        audioTags: allowedAudioLanguageTags,
        subtitleIso3Codes: allowedSubtitleLanguagesIso3,
        subtitleTags: allowedSubtitleLanguageTags,
      } = await this.mergeMovieAllowedLanguages(movie.id, original);
      // Spec 048, REQ-12; Spec 048, REQ-13
      const outputSettingKey =
        movie.isShort && (await this.mediaCapabilities.isShortsEnabled()) ? 'path_shorts' : 'path_movies';
      return {
        ...base,
        kind: 'MOVIE',
        tmdbId: movie.tmdbId,
        title: movie.title,
        year: movie.releaseDate?.getFullYear() ?? null,
        originalLanguage: movie.originalLanguage,
        originalLanguageIso3: original.iso3,
        // Prisma's generated `$Enums.ContentKind` is a string-literal union,
        // not the nominal TS enum `registerEnumType` needs for the GraphQL
        // field — same cross-boundary cast `preferences.resolver.ts` uses for
        // `LanguageTrackKind`, just in the opposite (read) direction.
        contentKind: movie.contentKind as unknown as ContentKind,
        seasonNumber: null,
        episodeNumber: null,
        episodeTitle: null,
        outputRoot: await this.resolveOutputRoot(outputSettingKey),
        allowedAudioLanguagesIso3,
        allowedAudioLanguageTags,
        allowedSubtitleLanguagesIso3,
        allowedSubtitleLanguageTags,
      };
    }

    if (processJob.episode) {
      const { episode } = processJob;
      const { show } = episode.season;
      const original = await this.resolveOriginalLanguage(show.originalLanguage);
      const {
        audioIso3Codes: allowedAudioLanguagesIso3,
        audioTags: allowedAudioLanguageTags,
        subtitleIso3Codes: allowedSubtitleLanguagesIso3,
        subtitleTags: allowedSubtitleLanguageTags,
      } = await this.mergeShowAllowedLanguages(show.id, original);
      return {
        ...base,
        kind: 'EPISODE',
        tmdbId: show.tmdbId,
        title: show.title,
        year: show.releaseDate?.getFullYear() ?? null,
        originalLanguage: show.originalLanguage,
        originalLanguageIso3: original.iso3,
        contentKind: show.contentKind as unknown as ContentKind,
        seasonNumber: episode.season.seasonNumber,
        episodeNumber: episode.episodeNumber,
        episodeTitle: episode.title,
        outputRoot: await this.resolveOutputRoot('path_shows'),
        allowedAudioLanguagesIso3,
        allowedAudioLanguageTags,
        allowedSubtitleLanguagesIso3,
        allowedSubtitleLanguageTags,
      };
    }

    throw new Error(`El processJob ${id} no tiene movie ni episode asociado`);
  }

  private async resolveOutputRoot(settingKey: 'path_movies' | 'path_shows' | 'path_shorts'): Promise<string> {
    const config = await this.settings.getMap();
    const relPath = config[settingKey];
    if (relPath === undefined) {
      throw i18nError.notFound(ERROR_KEYS.SETTING_MISSING, { key: settingKey });
    }
    return this.mediaRoots.resolveFromRoot('library', relPath);
  }

  private async resolveOriginalLanguage(originalLanguageIso2: string): Promise<{ tag: string; iso3: string }> {
    const language = await this.prisma.language.findUnique({ where: { tag: originalLanguageIso2 } });
    if (!language) {
      return { tag: 'en', iso3: 'eng' };
    }
    return { tag: language.tag, iso3: language.iso3 };
  }

  // Spec 029, REQ-3 REQ-8; Spec 030, REQ-8; Spec 030, AC-9; Spec 039, REQ-5; Spec 042, REQ-1 REQ-2
  private async mergeMovieAllowedLanguages(
    movieId: number,
    original: { tag: string; iso3: string },
  ): Promise<{ audioIso3Codes: string[]; audioTags: string[]; subtitleIso3Codes: string[]; subtitleTags: string[] }> {
    const owners = await this.prisma.userMovie.findMany({
      where: { movieId },
      select: {
        languages: { select: { kind: true, language: { select: { tag: true, iso3: true } } } },
        user: {
          select: {
            languages: { select: { kind: true, language: { select: { tag: true, iso3: true } } } },
          },
        },
      },
    });

    return this.collectAllowedLanguages(original, owners);
  }

  private async mergeShowAllowedLanguages(
    showId: number,
    original: { tag: string; iso3: string },
  ): Promise<{ audioIso3Codes: string[]; audioTags: string[]; subtitleIso3Codes: string[]; subtitleTags: string[] }> {
    const owners = await this.prisma.userShow.findMany({
      where: { showId },
      select: {
        languages: { select: { kind: true, language: { select: { tag: true, iso3: true } } } },
        user: {
          select: {
            languages: { select: { kind: true, language: { select: { tag: true, iso3: true } } } },
          },
        },
      },
    });

    return this.collectAllowedLanguages(original, owners);
  }

  // Spec 030, REQ-2
  private async resolveDefaultLanguages(): Promise<Array<{ tag: string; iso3: string }>> {
    const config = await this.settings.getMap();
    const rawValue = config['default_languages'];
    if (!rawValue) return [];

    const tags = rawValue
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);
    if (tags.length === 0) return [];

    const rows = await this.prisma.language.findMany({ where: { tag: { in: tags } } });
    const byTag = new Map(rows.map((row) => [row.tag, row.iso3]));

    return tags
      .map((tag) => {
        const iso3 = byTag.get(tag);
        return iso3 === undefined ? null : { tag, iso3 };
      })
      .filter((entry): entry is { tag: string; iso3: string } => entry !== null);
  }

  // Spec 039, REQ-5; Spec 042, REQ-1 REQ-2
  private async collectAllowedLanguages(
    original: { tag: string; iso3: string },
    owners: Array<{
      languages: Array<{ kind: LanguageTrackKind; language: { tag: string; iso3: string } }>;
      user: { languages: Array<{ kind: LanguageTrackKind; language: { tag: string; iso3: string } }> };
    }>,
  ): Promise<{ audioIso3Codes: string[]; audioTags: string[]; subtitleIso3Codes: string[]; subtitleTags: string[] }> {
    const audioIso3Codes = new Set<string>([original.iso3]);
    const audioTags = new Set<string>([original.tag]);
    const subtitleIso3Codes = new Set<string>([original.iso3]);
    const subtitleTags = new Set<string>([original.tag]);

    for (const defaultLanguage of await this.resolveDefaultLanguages()) {
      audioIso3Codes.add(defaultLanguage.iso3);
      audioTags.add(defaultLanguage.tag);
      subtitleIso3Codes.add(defaultLanguage.iso3);
      subtitleTags.add(defaultLanguage.tag);
    }
    for (const owner of owners) {
      for (const pref of [...owner.languages, ...owner.user.languages]) {
        if (pref.kind === LanguageTrackKind.AUDIO) {
          audioIso3Codes.add(pref.language.iso3);
          audioTags.add(pref.language.tag);
        } else {
          subtitleIso3Codes.add(pref.language.iso3);
          subtitleTags.add(pref.language.tag);
        }
      }
    }
    return {
      audioIso3Codes: Array.from(audioIso3Codes),
      audioTags: Array.from(audioTags),
      subtitleIso3Codes: Array.from(subtitleIso3Codes),
      subtitleTags: Array.from(subtitleTags),
    };
  }

  async encodeStarted(processJobId: number) {
    await this.prisma.processJob.update({
      where: { id: processJobId },
      data: { status: 'ENCODING' },
    });

    return `encoding: processJob ${processJobId}`;
  }

  async encodeProgress(processJobId: number, progress: number, speed?: number | null) {
    // Spec 053, NFR-3
    const encodeSpeed = speed === null || speed === undefined || !Number.isFinite(speed) || speed < 0 ? null : speed;

    await this.prisma.processJob.update({
      where: { id: processJobId },
      data: { progress, encodeSpeed },
    });

    return `progreso: processJob ${processJobId} ${progress}%`;
  }

  async encodeCompleted(processJobId: number, outputFilePath: string, ffmpegCommand: string) {
    // Spec 038, REQ-5; Spec 038, REQ-8
    const existing = await this.prisma.processJob.findUnique({
      where: { id: processJobId },
      include: { sourceFile: { select: { mediaSourceId: true, mediaSource: { select: { status: true } } } } },
    });

    if (!existing) {
      throw i18nError.notFound(ERROR_KEYS.PROCESS_JOB_NOT_FOUND, { id: processJobId });
    }

    // A retry whose predecessor already landed: same row, same output path.
    // Nothing left to propagate or to notify a second time.
    const alreadyDeliveredSame =
      existing.status === 'COMPLETED' && existing.outputFilePath === outputFilePath;
    // Spec 038, REQ-8
    const sourceDemoted = existing.sourceFile.mediaSource.status === 'ERROR';

    const processJob = await this.prisma.processJob.update({
      where: { id: processJobId },
      data: { status: 'COMPLETED', progress: 100, outputFilePath, ffmpegCommand, errorMessage: null, encodeSpeed: null },
      include: { sourceFile: { select: { mediaSourceId: true } } },
    });

    if (!alreadyDeliveredSame && !sourceDemoted) {
      if (processJob.movieId) {
        await this.prisma.movie.update({
          where: { id: processJob.movieId },
          data: { status: 'COMPLETED', filePath: outputFilePath },
        });
      } else if (processJob.episodeId) {
        await this.prisma.episode.update({
          where: { id: processJob.episodeId },
          data: { status: 'COMPLETED', filePath: outputFilePath },
        });
      }
    }

    // Spec 038, REQ-5
    if (!alreadyDeliveredSame) {
      await this.mediaServer.notifyCreated(outputFilePath);
    }

    // The three cleanup instructions (013-season-pack-processing). Computed
    // here, never worker-side, because they depend on rows the worker cannot
    // see: its sibling ProcessJobs and the source's hasUnmatchedFiles flag.
    const mediaSourceId = processJob.sourceFile.mediaSourceId;
    const [siblings, mediaSource] = await Promise.all([
      this.prisma.processJob.findMany({
        where: { sourceFile: { mediaSourceId } },
        select: { id: true, status: true },
      }),
      this.prisma.mediaSource.findUnique({
        where: { id: mediaSourceId },
        select: { hasUnmatchedFiles: true },
      }),
    ]);

    const nonTerminalStatuses = new Set(['WAITING', 'QUEUED', 'ENCODING']);
    // Last to *finish*, not last to *succeed*: a pack whose fifth episode
    // failed still drops the torrent once the tenth finishes.
    const removeTorrent = !siblings.some((sibling) => nonTerminalStatuses.has(sibling.status));
    // A season pack (>1 ProcessJob) releases each episode's input as it is
    // consumed; a single-job source (film/single episode) leaves this false
    // because deleteDownloadPath already removes everything.
    const deleteInputFile = siblings.length > 1;
    const deleteDownloadPath =
      siblings.every((sibling) => sibling.status === 'COMPLETED') && mediaSource?.hasUnmatchedFiles === false;

    return {
      message: `completado: processJob ${processJobId}`,
      removeTorrent,
      deleteInputFile,
      deleteDownloadPath,
    };
  }

  async encodeFailed(
    processJobId: number,
    errorKey: string,
    errorParams: string | undefined,
    errorMessage: string,
  ) {
    // Spec 038, REQ-8
    const existing = await this.prisma.processJob.findUnique({
      where: { id: processJobId },
      include: { sourceFile: { select: { mediaSource: { select: { status: true } } } } },
    });

    if (!existing) {
      throw i18nError.notFound(ERROR_KEYS.PROCESS_JOB_NOT_FOUND, { id: processJobId });
    }

    const sourceDemoted = existing.sourceFile.mediaSource.status === 'ERROR';

    const processJob = await this.prisma.processJob.update({
      where: { id: processJobId },
      data: { status: 'ERROR', errorKey, errorParams: errorParams ?? null, errorMessage, encodeSpeed: null },
    });

    if (!sourceDemoted) {
      await this.propagateJobError(processJob.movieId, processJob.episodeId);
    }

    return true;
  }

  // Shared by encodeFailed and the recovery-exhaustion branch of
  // reconcileOrphanedEncodes (054-interrupted-encode-recovery): both need to
  // move the title to ERROR, and factoring this out is what "reuse the
  // propagation rather than writing a second one" (api/plan.md § Steps 4d)
  // actually means in code, not just in prose.
  private async propagateJobError(movieId: number | null, episodeId: number | null): Promise<void> {
    if (movieId) {
      await this.prisma.movie.update({ where: { id: movieId }, data: { status: 'ERROR' } });
    } else if (episodeId) {
      await this.prisma.episode.update({ where: { id: episodeId }, data: { status: 'ERROR' } });
    }
  }

  // Spec 054, REQ-1; Spec 054, NFR-2; Spec 054, T006; Spec 054, NFR-6
  async reconcileOrphanedEncodes(): Promise<number> {
    const orphaned = await this.prisma.processJob.findMany({
      where: { status: 'ENCODING' },
      select: {
        id: true,
        movieId: true,
        episodeId: true,
        recoveryCount: true,
        movie: { select: { status: true } },
        episode: { select: { status: true } },
        sourceFile: { select: { mediaSource: { select: { status: true } } } },
      },
    });

    if (orphaned.length === 0) return 0;

    const failed: Array<{ id: number; movieId: number | null; episodeId: number | null }> = [];
    const requeued: number[] = [];
    let skipped = 0;

    for (const job of orphaned) {
      // Spec 054, REQ-5; Spec 038, REQ-8
      const mediaSource = job.sourceFile?.mediaSource;
      const targetStatus = job.movie?.status ?? job.episode?.status;
      if (!mediaSource || mediaSource.status === 'ERROR' || targetStatus === 'COMPLETED') {
        skipped += 1;
        continue;
      }

      if (job.recoveryCount >= RECOVERY_ALLOWANCE) {
        failed.push({ id: job.id, movieId: job.movieId, episodeId: job.episodeId });
        continue;
      }

      requeued.push(job.id);
    }

    if (failed.length > 0) {
      await this.failExhaustedEncodes(failed);
    }

    if (requeued.length > 0) {
      await this.requeueOrphanedEncodes(requeued);
    }

    return skipped + failed.length + requeued.length;
  }

  // Spec 054, REQ-4
  private async failExhaustedEncodes(
    jobs: Array<{ id: number; movieId: number | null; episodeId: number | null }>,
  ): Promise<void> {
    await this.prisma.processJob.updateMany({
      where: { id: { in: jobs.map((job) => job.id) } },
      data: {
        status: 'ERROR',
        errorKey: ERROR_KEYS.PROCESS_JOB_RECOVERY_EXHAUSTED,
        errorMessage: MESSAGES_EN[ERROR_KEYS.PROCESS_JOB_RECOVERY_EXHAUSTED],
        encodeSpeed: null,
      },
    });

    for (const job of jobs) {
      await this.propagateJobError(job.movieId, job.episodeId);
    }
  }

  // Spec 054, REQ-3
  private async requeueOrphanedEncodes(processJobIds: number[]): Promise<void> {
    await this.prisma.processJob.updateMany({
      where: { id: { in: processJobIds } },
      data: {
        status: 'WAITING',
        progress: 0,
        encodeSpeed: null,
        recoveryCount: { increment: 1 },
      },
    });

    const enqueued: number[] = [];
    for (const processJobId of processJobIds) {
      try {
        await this.encodeQueue.removeEncode(processJobId);
        await this.encodeQueue.addEncode({ processJobId });
        enqueued.push(processJobId);
      } catch (err) {
        console.error(`[reconcileOrphanedEncodes] failed to re-enqueue processJob ${processJobId}:`, err);
      }
    }

    if (enqueued.length > 0) {
      await this.prisma.processJob.updateMany({
        where: { id: { in: enqueued } },
        data: { status: 'QUEUED' },
      });
    }
  }

  // Spec 022, REQ-15
  async downloadRemove(mediaSourceId: number, deleteFiles: boolean = true) {
    const mediaSource = await this.prisma.mediaSource.findUnique({ where: { id: mediaSourceId } });
    if (!mediaSource) {
      throw i18nError.notFound(ERROR_KEYS.SOURCE_NOT_FOUND, { id: mediaSourceId });
    }

    // Spec 022, REQ-19; Spec 022, NFR-5
    if (mediaSource.infoHash) {
      await this.torrentClient.remove(mediaSource.infoHash, deleteFiles);
    }

    await this.sweepLosingSiblings(mediaSource);

    if (!mediaSource.infoHash) {
      return `omitido: mediaSource ${mediaSourceId} no es un torrent`;
    }

    return `removido: mediaSource ${mediaSourceId}`;
  }

  // Spec 022, REQ-15; Spec 022, REQ-14
  private async sweepLosingSiblings(winner: {
    id: number;
    movieId: number | null;
    episodeId: number | null;
    seasonId: number | null;
  }): Promise<void> {
    const targetWhere = winner.movieId
      ? { movieId: winner.movieId }
      : winner.episodeId
        ? { episodeId: winner.episodeId }
        : winner.seasonId
          ? { seasonId: winner.seasonId }
          : null;

    if (!targetWhere) return;

    const losers = await this.prisma.mediaSource.findMany({
      where: { ...targetWhere, id: { not: winner.id } },
    });

    for (const loser of losers) {
      if (loser.infoHash) {
        try {
          await this.torrentClient.remove(loser.infoHash, true);
        } catch (err) {
          // Spec 022, NFR-6
          console.error(`[downloadRemove] no se pudo borrar mediaSource ${loser.id} en el cliente de torrents:`, err);
          continue;
        }
      }
      await this.prisma.mediaSource.delete({ where: { id: loser.id } });
    }
  }
}
