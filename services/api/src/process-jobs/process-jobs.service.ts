import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { QbittorrentClient } from '@/clients/torrent/client';
import { SettingsService } from '@/settings/settings.service';
import { MediaRootsService } from '@/media-roots/media-roots.service';
import { MediaServerService } from '@/media-server/media-server.service';
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
      throw new NotFoundException(`El processJob ${id} no existe`);
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
    };

    if (processJob.movie) {
      const { movie } = processJob;
      return {
        ...base,
        kind: 'MOVIE',
        tmdbId: movie.tmdbId,
        title: movie.title,
        year: movie.releaseDate?.getFullYear() ?? null,
        originalLanguage: movie.originalLanguage,
        originalLanguageIso3: await this.resolveIso3(movie.originalLanguage),
        isLiveAction: movie.isLiveAction,
        seasonNumber: null,
        episodeNumber: null,
        episodeTitle: null,
        outputRoot: await this.resolveOutputRoot('path_movies'),
      };
    }

    if (processJob.episode) {
      const { episode } = processJob;
      const { show } = episode.season;
      return {
        ...base,
        kind: 'EPISODE',
        tmdbId: show.tmdbId,
        title: show.title,
        year: show.releaseDate?.getFullYear() ?? null,
        originalLanguage: show.originalLanguage,
        originalLanguageIso3: await this.resolveIso3(show.originalLanguage),
        isLiveAction: show.isLiveAction,
        seasonNumber: episode.season.seasonNumber,
        episodeNumber: episode.episodeNumber,
        episodeTitle: episode.title,
        outputRoot: await this.resolveOutputRoot('path_shows'),
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
      throw new NotFoundException(`Falta la setting "${settingKey}" — configurala en Settings antes de encodear.`);
    }
    return this.mediaRoots.resolveFromRoot('library', relPath);
  }

  // Movie/Show guardan el idioma como iso2 (TMDB). El driver de ffmpeg necesita
  // iso3 para comparar contra tags.language de ffprobe. Si el idioma no está
  // sembrado en la tabla languages, cae a 'eng' en vez de romper el job — un
  // idioma sin traducir es mejor que un encode que nunca arranca.
  private async resolveIso3(originalLanguageIso2: string): Promise<string> {
    const language = await this.prisma.language.findUnique({ where: { iso2: originalLanguageIso2 } });
    return language?.iso3 ?? 'eng';
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

    return `completado: processJob ${processJobId}`;
  }

  async encodeFailed(processJobId: number, errorMessage: string) {
    const processJob = await this.prisma.processJob.update({
      where: { id: processJobId },
      data: { status: 'ERROR', errorMessage },
    });

    if (processJob.movieId) {
      await this.prisma.movie.update({ where: { id: processJob.movieId }, data: { status: 'ERROR' } });
    } else if (processJob.episodeId) {
      await this.prisma.episode.update({ where: { id: processJob.episodeId }, data: { status: 'ERROR' } });
    }

    return `error: processJob ${processJobId}`;
  }

  async downloadRemove(mediaSourceId: number) {
    const mediaSource = await this.prisma.mediaSource.findUnique({ where: { id: mediaSourceId } });
    if (!mediaSource) {
      throw new NotFoundException(`El mediaSource ${mediaSourceId} no existe`);
    }

    // LOCAL_FILE/LOCAL_FOLDER no tienen infoHash: no hay nada que sacarle al
    // cliente de torrents.
    if (!mediaSource.infoHash) {
      return `omitido: mediaSource ${mediaSourceId} no es un torrent`;
    }

    await this.torrentClient.remove(mediaSource.infoHash, true);
    return `removido: mediaSource ${mediaSourceId}`;
  }
}
