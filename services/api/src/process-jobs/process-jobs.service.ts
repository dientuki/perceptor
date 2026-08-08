import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { QbittorrentClient } from '@/clients/torrent/client';
import { EncodeJobDetails } from './entities/encode-job-details.entity';

@Injectable()
export class ProcessJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly torrentClient: QbittorrentClient,
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
        isLiveAction: movie.isLiveAction,
        seasonNumber: null,
        episodeNumber: null,
        episodeTitle: null,
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
        isLiveAction: show.isLiveAction,
        seasonNumber: episode.season.seasonNumber,
        episodeNumber: episode.episodeNumber,
        episodeTitle: episode.title,
      };
    }

    // No debería pasar: sourceScanned siempre setea uno de los dos al crear el
    // ProcessJob. Si pasa, es un dato corrupto — mejor que el worker falle acá
    // con un mensaje claro a que arme una ruta de salida sin media asociada.
    throw new Error(`El processJob ${id} no tiene movie ni episode asociado`);
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
