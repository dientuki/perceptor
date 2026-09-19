import { Injectable } from '@nestjs/common';
import { MoviesService } from '@/movies/movies.service';
import { ShowsService } from '@/shows/shows.service';
import { MediaCapabilitiesService } from '@/media/media-capabilities.service';
import { parseCalendarRange } from './calendar-range';
import { groupEpisodes } from './group-episodes';
import { CalendarEntry } from './entities/calendar-entry.entity';
import { CalendarEntryKind } from './entities/calendar-entry-kind.enum';

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

@Injectable()
export class CalendarService {
  constructor(
    private readonly moviesService: MoviesService,
    private readonly showsService: ShowsService,
    private readonly mediaCapabilitiesService: MediaCapabilitiesService,
  ) {}

  async list(userId: string, from: string, to: string): Promise<CalendarEntry[]> {
    const range = parseCalendarRange(from, to);
    const capabilities = await this.mediaCapabilitiesService.read();
    const entries: CalendarEntry[] = [];

    if (capabilities.moviesEnabled) {
      const movies = await this.moviesService.findReleasedBetween(userId, range.from, range.toExclusive);
      for (const movie of movies) {
        if (!movie.releaseDate) continue;
        if (movie.isShort && !capabilities.shortsEnabled) continue;
        entries.push({
          kind: movie.isShort ? CalendarEntryKind.SHORT : CalendarEntryKind.MOVIE,
          mediaId: movie.id,
          title: movie.title,
          date: movie.releaseDate.toISOString().slice(0, 10),
          status: movie.status,
        });
      }
    }

    if (capabilities.showsEnabled) {
      const rows = await this.showsService.findEpisodesReleasedBetween(userId, range.from, range.toExclusive);
      for (const group of groupEpisodes(rows)) {
        entries.push({
          kind: CalendarEntryKind.EPISODES,
          mediaId: group.showId,
          title: group.showTitle,
          date: group.date,
          status: group.status,
          seasonNumber: group.seasonNumber,
          firstEpisodeNumber: group.firstEpisodeNumber,
          lastEpisodeNumber: group.lastEpisodeNumber,
          episodeTitle: group.episodeTitle,
          episodeCount: group.episodeCount,
          completedCount: group.completedCount,
        });
      }
    }

    return entries.sort(
      (a, b) =>
        compareText(a.date, b.date) ||
        compareText(a.title, b.title) ||
        (a.seasonNumber ?? 0) - (b.seasonNumber ?? 0) ||
        (a.firstEpisodeNumber ?? 0) - (b.firstEpisodeNumber ?? 0),
    );
  }
}
