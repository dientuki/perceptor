import { Injectable } from '@nestjs/common';
import { LanguageTrackKind } from '@prisma/client';

import { ERROR_KEYS } from '@/i18n/error-keys';
import { i18nError } from '@/i18n/i18n-error';
import { LanguagesService } from '@/languages/languages.service';
import { MoviesService } from '@/movies/movies.service';
import { EpisodesService } from '@/episodes/episodes.service';
import { PreferencesService } from '@/preferences/preferences.service';
import { PrismaService } from '@/prisma/prisma.service';
import { SeasonsService } from '@/seasons/seasons.service';
import { ShowsService } from '@/shows/shows.service';

import type { LanguageRequirement, RankingContext, RankingLanguage } from './ranking';

export type SearchTarget =
  | { movieId: number }
  | { seasonId: number }
  | { episodeId: number }
  | null;

type EffectiveAudio = { mandatory: boolean; languages: RankingLanguage[] };

@Injectable()
export class RankingContextService {
  constructor(
    private readonly moviesService: MoviesService,
    private readonly showsService: ShowsService,
    private readonly seasonsService: SeasonsService,
    private readonly episodesService: EpisodesService,
    private readonly preferencesService: PreferencesService,
    private readonly languagesService: LanguagesService,
    private readonly prisma: PrismaService,
  ) {}

  async forCaller(userId: string, target: SearchTarget): Promise<RankingContext> {
    if (target === null) {
      return { languageRequirement: null, preferredGroups: [], allowCinemaReleases: true };
    }

    const preferences = await this.preferencesService.findForUser(userId);

    if ('movieId' in target) {
      const movie = await this.moviesService.findOneFromDb(target.movieId, userId);
      if (movie === null) {
        throw i18nError.notFound(ERROR_KEYS.MOVIE_NOT_FOUND, { id: target.movieId });
      }
      const [mandatory, languages] = await Promise.all([
        this.moviesService.findAudioMandatoryFor(userId, movie.id),
        this.languagesService.findMoviePreferredTrackLanguagesFor(
          userId,
          movie.id,
          LanguageTrackKind.AUDIO,
        ),
      ]);
      return {
        languageRequirement: this.withFallback({ mandatory, languages }, preferences),
        preferredGroups: preferences.movieTorrentGroups.map((g) => g.name),
        allowCinemaReleases: preferences.allowCinemaReleases,
      };
    }

    let showId: number;
    if ('seasonId' in target) {
      const season = await this.seasonsService.findOneFromDb(target.seasonId, userId);
      if (season === null) {
        throw i18nError.notFound(ERROR_KEYS.SEASON_NOT_FOUND, { id: target.seasonId });
      }
      showId = season.show.id;
    } else {
      const episode = await this.episodesService.findOneFromDb(target.episodeId, userId);
      if (episode === null) {
        throw i18nError.notFound(ERROR_KEYS.EPISODE_NOT_FOUND, { id: target.episodeId });
      }
      showId = episode.season.show.id;
    }

    const [mandatory, languages] = await Promise.all([
      this.showsService.findAudioMandatoryFor(userId, showId),
      this.languagesService.findShowPreferredTrackLanguagesFor(
        userId,
        showId,
        LanguageTrackKind.AUDIO,
      ),
    ]);
    return {
      languageRequirement: this.withFallback({ mandatory, languages }, preferences),
      preferredGroups: preferences.showTorrentGroups.map((g) => g.name),
      allowCinemaReleases: true,
    };
  }

  async forShowOwners(showId: number): Promise<RankingContext> {
    const owners = await this.prisma.userShow.findMany({
      where: { showId },
      orderBy: { createdAt: 'asc' },
    });

    let mandatory = false;
    const languages = new Map<string, RankingLanguage>();
    const groups = new Set<string>();

    for (const owner of owners) {
      const [preferences, ownLanguages] = await Promise.all([
        this.preferencesService.findForUser(owner.userId),
        this.languagesService.findShowPreferredTrackLanguagesFor(
          owner.userId,
          showId,
          LanguageTrackKind.AUDIO,
        ),
      ]);
      const effective = this.effectiveAudio(
        { mandatory: owner.audioMandatory, languages: ownLanguages },
        preferences,
      );
      mandatory = mandatory || effective.mandatory;
      for (const language of effective.languages) {
        languages.set(language.iso3.toLowerCase(), {
          iso2: language.iso2,
          iso3: language.iso3,
        });
      }
      for (const group of preferences.showTorrentGroups) {
        groups.add(group.name);
      }
    }

    return {
      languageRequirement: { mandatory, languages: Array.from(languages.values()) },
      preferredGroups: Array.from(groups),
      allowCinemaReleases: true,
    };
  }

  private effectiveAudio(
    title: EffectiveAudio,
    preferences: { audioMandatory: boolean; audioLanguages: RankingLanguage[] },
  ): EffectiveAudio {
    return title.languages.length === 0
      ? { mandatory: preferences.audioMandatory, languages: preferences.audioLanguages }
      : title;
  }

  private withFallback(
    title: EffectiveAudio,
    preferences: { audioMandatory: boolean; audioLanguages: RankingLanguage[] },
  ): LanguageRequirement {
    return this.effectiveAudio(title, preferences);
  }
}
