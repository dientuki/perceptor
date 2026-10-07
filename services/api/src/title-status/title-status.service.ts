import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { deriveTitleStatus, deriveEpisodeStatus, deriveShowStatus } from '@/pipeline-status/pipeline-status';

// Spec 089, REQ-1 REQ-2 REQ-3 REQ-4 REQ-11 REQ-13
@Injectable()
export class TitleStatusService {
  constructor(private readonly prisma: PrismaService) {}

  async recomputeMovie(movieId: number): Promise<void> {
    const movie = await this.prisma.movie.findUnique({
      where: { id: movieId },
      include: { mediaSources: true, processJobs: true },
    });
    if (!movie) return;

    const derived = deriveTitleStatus({
      filePath: movie.filePath,
      mediaServerPresentAt: movie.mediaServerPresentAt,
      sources: movie.mediaSources,
      jobs: movie.processJobs,
    });

    await this.prisma.movie.updateMany({
      where: { id: movieId, status: movie.status },
      data: { status: derived },
    });
  }

  async recomputeEpisode(episodeId: number): Promise<void> {
    const showId = await this.writeEpisodeStatus(episodeId);
    if (showId !== null) {
      await this.recomputeShow(showId);
    }
  }

  async recomputeSeason(seasonId: number): Promise<void> {
    const season = await this.prisma.season.findUnique({
      where: { id: seasonId },
      select: { showId: true, episodes: { select: { id: true } } },
    });
    if (!season) return;

    for (const episode of season.episodes) {
      await this.writeEpisodeStatus(episode.id);
    }

    await this.recomputeShow(season.showId);
  }

  async recomputeShow(showId: number): Promise<void> {
    const show = await this.prisma.show.findUnique({
      where: { id: showId },
      select: {
        status: true,
        seasons: { select: { episodes: { select: { status: true, releaseDate: true } } } },
      },
    });
    if (!show) return;

    const episodes = show.seasons.flatMap((season) => season.episodes);
    const derived = deriveShowStatus(episodes, new Date());

    await this.prisma.show.updateMany({
      where: { id: showId, status: show.status },
      data: { status: derived },
    });
  }

  // Writes the episode's own status (including the 059 season-pack lift, read from its season's
  // sources) and returns the id of the series it belongs to, or null if the episode no longer
  // exists — the caller decides whether to cascade.
  private async writeEpisodeStatus(episodeId: number): Promise<number | null> {
    const episode = await this.prisma.episode.findUnique({
      where: { id: episodeId },
      include: {
        mediaSources: true,
        processJobs: true,
        season: { select: { showId: true, mediaSources: true } },
      },
    });
    if (!episode) return null;

    const derived = deriveEpisodeStatus(
      episode.season.mediaSources,
      {
        filePath: episode.filePath,
        mediaServerPresentAt: episode.mediaServerPresentAt,
        releaseDate: episode.releaseDate,
        mediaSources: episode.mediaSources,
        processJobs: episode.processJobs,
      },
      new Date(),
    );

    await this.prisma.episode.updateMany({
      where: { id: episodeId, status: episode.status },
      data: { status: derived },
    });

    return episode.season.showId;
  }
}
