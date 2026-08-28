import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { QbittorrentClient } from '@/clients/torrent/client';
import { SettingsService } from '@/settings/settings.service';
import { MediaRootsService } from '@/media-roots/media-roots.service';
import { MediaServerService } from '@/media-server/media-server.service';
import { ERROR_KEYS } from '@/i18n/error-keys';
import { i18nError } from '@/i18n/i18n-error';
import { EncodeJobDetails } from './entities/encode-job-details.entity';

@Injectable()
export class ProcessJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly torrentClient: QbittorrentClient,
    private readonly settings: SettingsService,
    private readonly mediaRoots: MediaRootsService,
    private readonly mediaServer: MediaServerService,
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
    const base = {
      id: processJob.id,
      status: processJob.status,
      inputFilePath: processJob.sourceFile.filePath,
      mediaSourceId: mediaSource.id,
      sourceKind: mediaSource.kind,
      infoHash: mediaSource.infoHash,
      downloadPath: mediaSource.downloadPath,
      downloadsRoot: await this.mediaRoots.resolveFromRoot('downloads', '.'),
    };

    if (processJob.movie) {
      const { movie } = processJob;
      const original = await this.resolveOriginalLanguage(movie.originalLanguage);
      const { iso3Codes: allowedLanguagesIso3, tags: allowedLanguageTags } = await this.mergeMovieAllowedLanguages(
        movie.id,
        original,
      );
      return {
        ...base,
        kind: 'MOVIE',
        tmdbId: movie.tmdbId,
        title: movie.title,
        year: movie.releaseDate?.getFullYear() ?? null,
        originalLanguage: movie.originalLanguage,
        originalLanguageIso3: original.iso3,
        isLiveAction: movie.isLiveAction,
        seasonNumber: null,
        episodeNumber: null,
        episodeTitle: null,
        outputRoot: await this.resolveOutputRoot('path_movies'),
        allowedLanguagesIso3,
        allowedLanguageTags,
      };
    }

    if (processJob.episode) {
      const { episode } = processJob;
      const { show } = episode.season;
      const original = await this.resolveOriginalLanguage(show.originalLanguage);
      const { iso3Codes: allowedLanguagesIso3, tags: allowedLanguageTags } = await this.mergeShowAllowedLanguages(
        show.id,
        original,
      );
      return {
        ...base,
        kind: 'EPISODE',
        tmdbId: show.tmdbId,
        title: show.title,
        year: show.releaseDate?.getFullYear() ?? null,
        originalLanguage: show.originalLanguage,
        originalLanguageIso3: original.iso3,
        isLiveAction: show.isLiveAction,
        seasonNumber: episode.season.seasonNumber,
        episodeNumber: episode.episodeNumber,
        episodeTitle: episode.title,
        outputRoot: await this.resolveOutputRoot('path_shows'),
        allowedLanguagesIso3,
        allowedLanguageTags,
      };
    }

    // No debería pasar: sourceScanned siempre setea uno de los dos al crear el
    // ProcessJob. Si pasa, es un dato corrupto — mejor que el worker falle acá
    // con un mensaje claro a que arme una ruta de salida sin media asociada.
    throw new Error(`El processJob ${id} no tiene movie ni episode asociado`);
  }

  // Resuelve path_movies/path_shows (relativos a la raíz "library", ver
  // media-roots/) a la ruta absoluta de container que el worker va a usar
  // para armar la carpeta de salida. Si la setting falta o se escapa de la
  // raíz, el job falla acá con un mensaje claro — mejor que el worker
  // reciba una ruta ambigua o escriba fuera de la biblioteca.
  private async resolveOutputRoot(settingKey: 'path_movies' | 'path_shows'): Promise<string> {
    const config = await this.settings.getMap();
    const relPath = config[settingKey];
    if (relPath === undefined) {
      throw i18nError.notFound(ERROR_KEYS.SETTING_MISSING, { key: settingKey });
    }
    return this.mediaRoots.resolveFromRoot('library', relPath);
  }

  // Movie/Show guardan el idioma como iso2 (TMDB). El driver de ffmpeg necesita
  // iso3 para comparar contra tags.language de ffprobe. Si el idioma no está
  // sembrado en la tabla languages, cae a { tag: 'en', iso3: 'eng' } en vez de
  // romper el job — un idioma sin traducir es mejor que un encode que nunca
  // arranca.
  //
  // 030-language-regional-variants: `iso2` is no longer unique (three rows
  // now share `es`), so this looks up by `tag` instead of `iso2` — a base
  // row's tag IS its ISO-639-1 code by construction, and TMDB's
  // `originalLanguage` is exactly an ISO-639-1 code. This is exact, not
  // approximate: `findFirst` on `iso2` would compile just as well but could
  // nondeterministically return a variant row (e.g. `es-419`) for a plain
  // Spanish title, silently attributing a regional preference the user never
  // expressed. See ../plan.md § Risks.
  private async resolveOriginalLanguage(originalLanguageIso2: string): Promise<{ tag: string; iso3: string }> {
    const language = await this.prisma.language.findUnique({ where: { tag: originalLanguageIso2 } });
    if (!language) {
      return { tag: 'en', iso3: 'eng' };
    }
    return { tag: language.tag, iso3: language.iso3 };
  }

  // REQ-3/REQ-8 (029), extended by REQ-8/AC-9 (030): the set of languages an
  // encode may keep is {original} ∪ the installation's `default_languages`
  // setting ∪ every owner's per-title preference, deduplicated, original
  // first — expressed as BOTH the ISO-639-2/B list the worker matches
  // against (`allowedLanguagesIso3`) and the BCP-47 tag list that survives
  // the collapse to iso3 (`allowedLanguageTags`). Both lists come out of the
  // SAME walk in `collectAllowedLanguages` on purpose: two separate merges
  // could drift (e.g. a tag added to one Set but not the other), which would
  // silently mismatch the two fields on the wire with no error anywhere. A
  // `Set` per list gives us dedup and insertion order for free. A title with
  // no owners and no default falls through to just the original — no special
  // case needed (see plan.md's risk list).
  private async mergeMovieAllowedLanguages(
    movieId: number,
    original: { tag: string; iso3: string },
  ): Promise<{ iso3Codes: string[]; tags: string[] }> {
    const owners = await this.prisma.userMovie.findMany({
      where: { movieId },
      select: {
        languages: { select: { language: { select: { tag: true, iso3: true } } } },
      },
    });

    return this.collectAllowedLanguages(original, owners);
  }

  private async mergeShowAllowedLanguages(
    showId: number,
    original: { tag: string; iso3: string },
  ): Promise<{ iso3Codes: string[]; tags: string[] }> {
    const owners = await this.prisma.userShow.findMany({
      where: { showId },
      select: {
        languages: { select: { language: { select: { tag: true, iso3: true } } } },
      },
    });

    return this.collectAllowedLanguages(original, owners);
  }

  // Reads the installation-wide `default_languages` setting (BCP-47 tags,
  // comma separated since 030-language-regional-variants) and resolves each
  // tag to its { tag, iso3 } pair, mirroring `resolveOriginalLanguage`. An
  // unknown tag is dropped rather than thrown here — `SettingsService.updateMany`
  // is the only place that rejects an unknown tag; by the time this runs the
  // setting was already validated at write time, and a stale/renamed row must
  // not break every encode that follows.
  //
  // 030-language-regional-variants: looks up by `tag`, not `iso2` — `iso2`
  // stopped being unique the moment `es-419`/`es-ES` were seeded, and
  // `default_languages` itself now stores tags (REQ-2), so a lookup left on
  // `iso2` would match nothing and the installation default would silently
  // contribute no languages to any encode.
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

  private async collectAllowedLanguages(
    original: { tag: string; iso3: string },
    owners: Array<{
      languages: Array<{ language: { tag: string; iso3: string } }>;
    }>,
  ): Promise<{ iso3Codes: string[]; tags: string[] }> {
    const iso3Codes = new Set<string>([original.iso3]);
    const tags = new Set<string>([original.tag]);

    for (const defaultLanguage of await this.resolveDefaultLanguages()) {
      iso3Codes.add(defaultLanguage.iso3);
      tags.add(defaultLanguage.tag);
    }
    for (const owner of owners) {
      for (const titlePref of owner.languages) {
        iso3Codes.add(titlePref.language.iso3);
        tags.add(titlePref.language.tag);
      }
    }
    return { iso3Codes: Array.from(iso3Codes), tags: Array.from(tags) };
  }

  async encodeStarted(processJobId: number) {
    await this.prisma.processJob.update({
      where: { id: processJobId },
      data: { status: 'ENCODING' },
    });

    return `encoding: processJob ${processJobId}`;
  }

  async encodeProgress(processJobId: number, progress: number) {
    await this.prisma.processJob.update({
      where: { id: processJobId },
      data: { progress },
    });

    return `progreso: processJob ${processJobId} ${progress}%`;
  }

  async encodeCompleted(processJobId: number, outputFilePath: string, ffmpegCommand: string) {
    const processJob = await this.prisma.processJob.update({
      where: { id: processJobId },
      data: { status: 'COMPLETED', progress: 100, outputFilePath, ffmpegCommand, errorMessage: null },
      include: { sourceFile: { select: { mediaSourceId: true } } },
    });

    // Propaga a la media consolidada, igual que downloads.service hace con
    // ENCODING al arrancar: la UI mira Movie/Episode.status, no ProcessJob.
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

    // El archivo ya está en la biblioteca y la DB ya lo refleja: recién ahora se
    // avisa. notifyCreated se traga sus propios errores a propósito (ver ahí).
    await this.mediaServer.notifyCreated(outputFilePath);

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
    const processJob = await this.prisma.processJob.update({
      where: { id: processJobId },
      data: { status: 'ERROR', errorKey, errorParams: errorParams ?? null, errorMessage },
    });

    if (processJob.movieId) {
      await this.prisma.movie.update({ where: { id: processJob.movieId }, data: { status: 'ERROR' } });
    } else if (processJob.episodeId) {
      await this.prisma.episode.update({ where: { id: processJob.episodeId }, data: { status: 'ERROR' } });
    }

    return true;
  }

  // `deleteFiles` defaults to `true` for backward compatibility with any
  // caller that predates this argument. This pipeline (encodeCompleted's
  // removeTorrent instruction) always passes `false`: the worker owns every
  // deletion, behind isInsideRoot, so the client is never asked to delete
  // anything itself. Signature, `omitido:` string and return type are all
  // unchanged (the worker calls this and is not in `services:`) — but
  // 022-download-status-tags REQ-15 grew its behaviour: it now also sweeps
  // every losing sibling of the same target.
  async downloadRemove(mediaSourceId: number, deleteFiles: boolean = true) {
    const mediaSource = await this.prisma.mediaSource.findUnique({ where: { id: mediaSourceId } });
    if (!mediaSource) {
      throw i18nError.notFound(ERROR_KEYS.SOURCE_NOT_FOUND, { id: mediaSourceId });
    }

    // LOCAL_FILE/LOCAL_FOLDER no tienen infoHash: no hay nada que sacarle al
    // cliente de torrents para ESTA fila. The sweep below must still run:
    // under REQ-19 the winner can be an upload, and if the sweep only ran
    // after torrentClient.remove, an upload winner would leave every
    // losing torrent downloading and seeding forever with nothing pointing
    // at them (spec.md NFR-5 (c)). Only the winner's own remove is skipped.
    if (mediaSource.infoHash) {
      await this.torrentClient.remove(mediaSource.infoHash, deleteFiles);
    }

    await this.sweepLosingSiblings(mediaSource);

    if (!mediaSource.infoHash) {
      return `omitido: mediaSource ${mediaSourceId} no es un torrent`;
    }

    return `removido: mediaSource ${mediaSourceId}`;
  }

  // REQ-15: once the winner's own torrent (or upload) is cleaned up, every
  // losing sibling of the same target — selected by movieId/episodeId/
  // seasonId, never by tag (REQ-14: a tag is a title string, shared across
  // users and titles, with no ownership and no identity) — has its torrent
  // removed **with** files and its row deleted outright. No history kept.
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
          // NFR-6: an unacknowledged delete must not delete the row either —
          // that would leave the loser's torrent and files on disk with
          // nothing left tracking them.
          console.error(`[downloadRemove] no se pudo borrar mediaSource ${loser.id} en el cliente de torrents:`, err);
          continue;
        }
      }
      await this.prisma.mediaSource.delete({ where: { id: loser.id } });
    }
  }
}
