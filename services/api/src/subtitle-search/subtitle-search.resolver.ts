import {
  Args,
  Float,
  Int,
  Mutation,
  Parent,
  Query,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import { AllowService } from '@/auth/decorators/allow-service.decorator';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import type { AuthPrincipal } from '@/auth/auth.types';
import { i18nError } from '@/i18n/i18n-error';
import { ERROR_KEYS } from '@/i18n/error-keys';
import { Movie } from '@/movies/entities/movies.entity';
import { Episode } from '@/shows/entities/episode.entity';
import {
  SubtitleSearch,
  SubtitleSyncReference,
} from './entities/subtitle-search.entity';
import { SubtitleProbeDetails } from './entities/subtitle-probe-details.entity';
import { SubtitleSyncDetails } from './entities/subtitle-sync-details.entity';
import { MediaCapabilitiesService } from '@/media/media-capabilities.service';
import { SubtitleSearchRequestService } from './subtitle-search-request.service';
import { SubtitleSearchService } from './subtitle-search.service';

// Spec 103, REQ-13
@Resolver(() => Movie)
export class MovieSubtitleSearchFieldsResolver {
  constructor(private readonly service: SubtitleSearchService) {}

  @ResolveField(() => SubtitleSearch, {
    nullable: true,
    description: "The film's most recent search, null if it never had one.",
  })
  latestSubtitleSearch(@Parent() movie: Movie) {
    return this.service.latestForMovie(Number(movie.id));
  }
}

// Spec 103, REQ-13
@Resolver(() => Episode)
export class EpisodeSubtitleSearchFieldsResolver {
  constructor(private readonly service: SubtitleSearchService) {}

  @ResolveField(() => SubtitleSearch, { nullable: true })
  latestSubtitleSearch(@Parent() episode: Episode) {
    return this.service.latestForEpisode(Number(episode.id));
  }
}

// Spec 103, REQ-10
@Resolver()
export class SubtitleSearchResolver {
  constructor(
    private readonly service: SubtitleSearchService,
    private readonly capabilities: MediaCapabilitiesService,
    private readonly requests: SubtitleSearchRequestService,
  ) {}

  // Spec 106, REQ-1 REQ-2
  @Mutation(() => SubtitleSearch, {
    name: 'searchMovieSubtitles',
    description:
      'Starts a 103 subtitle search for a film the caller owns that already holds a file (106).',
  })
  async searchMovieSubtitles(
    @Args('movieId', { type: () => Int }) movieId: number,
    @CurrentUser() principal: AuthPrincipal,
  ) {
    const userId = assertUser(principal);
    await this.capabilities.assertSubtitleSearchAvailable();
    await this.requests.requestForCaller({ kind: 'movie', id: movieId }, userId);
    return this.latestOrFail(await this.service.latestForMovie(movieId));
  }

  // Spec 106, REQ-1 REQ-2
  @Mutation(() => SubtitleSearch, {
    name: 'searchEpisodeSubtitles',
    description: 'Same, for an episode of a series the caller owns.',
  })
  async searchEpisodeSubtitles(
    @Args('episodeId', { type: () => Int }) episodeId: number,
    @CurrentUser() principal: AuthPrincipal,
  ) {
    const userId = assertUser(principal);
    await this.capabilities.assertSubtitleSearchAvailable();
    await this.requests.requestForCaller(
      { kind: 'episode', id: episodeId },
      userId,
    );
    return this.latestOrFail(await this.service.latestForEpisode(episodeId));
  }

  private latestOrFail<T>(row: T | null): T {
    if (!row) throw i18nError.notFound(ERROR_KEYS.SOURCE_NOT_FOUND);
    return row;
  }

  @AllowService()
  @Query(() => SubtitleSyncDetails, {
    name: 'subtitleSyncDetails',
    description:
      'Service-only (worker). Container paths, same standing as SubtitleEmbedDetails.',
  })
  subtitleSyncDetails(
    @Args('id', { type: () => Int }) id: number,
    @CurrentUser() principal: AuthPrincipal,
  ) {
    assertService(principal);
    return this.service.details(id);
  }

  @AllowService()
  @Mutation(() => Boolean, {
    name: 'subtitleSyncStarted',
    description:
      'Service-only (worker). Moves a queued validation to running; false if it is no longer queued.',
  })
  subtitleSyncStarted(
    @Args('id', { type: () => Int }) id: number,
    @CurrentUser() principal: AuthPrincipal,
  ) {
    assertService(principal);
    return this.service.started(id);
  }

  @AllowService()
  @Mutation(() => Boolean, {
    name: 'subtitleSyncCompleted',
    description:
      "Service-only (worker). Safe to receive more than once (038's posture). api applies REQ-10's acceptance rule.",
  })
  subtitleSyncCompleted(
    @Args('id', { type: () => Int }) id: number,
    @Args('offsetMs', { type: () => Int }) offsetMs: number,
    @Args('framerateRatio', { type: () => Float }) framerateRatio: number,
    @Args('reference', { type: () => SubtitleSyncReference })
    reference: SubtitleSyncReference,
    @Args('score', { type: () => Float }) score: number,
    @Args('mediaDurationMs', { type: () => Int }) mediaDurationMs: number,
    @Args('lastChapterStartMs', { type: () => Int, nullable: true })
    lastChapterStartMs: number | null | undefined,
    @CurrentUser() principal: AuthPrincipal,
  ) {
    assertService(principal);
    return this.service.completed(id, {
      mediaDurationMs,
      lastChapterStartMs: lastChapterStartMs ?? null,
      offsetMs,
      framerateRatio,
      reference,
      score,
    });
  }

  @AllowService()
  @Mutation(() => Boolean, {
    name: 'subtitleSyncFailed',
    description: 'Service-only (worker). Safe to receive more than once.',
  })
  subtitleSyncFailed(
    @Args('id', { type: () => Int }) id: number,
    @Args('errorKey') errorKey: string,
    @CurrentUser() principal: AuthPrincipal,
  ) {
    assertService(principal);
    return this.service.failed(id, errorKey);
  }

  // Spec 107, T005
  @AllowService()
  @Query(() => SubtitleProbeDetails, {
    name: 'subtitleProbeDetails',
    description: 'Service-only (worker). Same standing as SubtitleSyncDetails.',
  })
  subtitleProbeDetails(
    @Args('id', { type: () => Int }) id: number,
    @CurrentUser() principal: AuthPrincipal,
  ) {
    assertService(principal);
    return this.service.probeDetails(id);
  }

  @AllowService()
  @Mutation(() => Boolean, {
    name: 'subtitleProbeStarted',
    description:
      'Service-only (worker). Records that the probe started (107 NFR-2); false if the search is no longer WAITING, and the worker then abandons silently.',
  })
  subtitleProbeStarted(
    @Args('id', { type: () => Int }) id: number,
    @CurrentUser() principal: AuthPrincipal,
  ) {
    assertService(principal);
    return this.service.probeStarted(id);
  }

  @AllowService()
  @Mutation(() => Boolean, {
    name: 'subtitleProbeCompleted',
    description:
      'Service-only (worker). Safe to receive more than once; false if the search is no longer WAITING.',
  })
  subtitleProbeCompleted(
    @Args('id', { type: () => Int }) id: number,
    @Args('embeddedLanguagesIso3', {
      type: () => [String],
      description:
        'ISO 639-2 codes of the non-forced embedded subtitle tracks (107 REQ-3).',
    })
    embeddedLanguagesIso3: string[],
    @Args('sidecarLanguageTags', {
      type: () => [String],
      description:
        'Language tags of the non-forced sidecars, as written in their names (`es`, `es-419`, `spa`, `Spanish`); api resolves them (107 REQ-3).',
    })
    sidecarLanguageTags: string[],
    @Args('fileSizeBytes', {
      type: () => Float,
      description: "File size in bytes. Float: a library file exceeds Int's 2^31.",
    })
    fileSizeBytes: number,
    @Args('movieHash', {
      description: 'OpenSubtitles hash of the file, 16 lowercase hex digits.',
    })
    movieHash: string,
    @CurrentUser() principal: AuthPrincipal,
  ) {
    assertService(principal);
    return this.service.probeCompleted(id, {
      embeddedLanguagesIso3,
      sidecarLanguageTags,
      fileSizeBytes,
      movieHash,
    });
  }

  @AllowService()
  @Mutation(() => Boolean, {
    name: 'subtitleProbeFailed',
    description: 'Service-only (worker). Safe to receive more than once.',
  })
  subtitleProbeFailed(
    @Args('id', { type: () => Int }) id: number,
    @Args('errorKey') errorKey: string,
    @CurrentUser() principal: AuthPrincipal,
  ) {
    assertService(principal);
    return this.service.probeFailed(id, errorKey);
  }
}

function assertService(principal: AuthPrincipal): void {
  if (principal.type !== 'service') {
    throw i18nError.unauthorized(ERROR_KEYS.AUTH_UNAUTHENTICATED);
  }
}

function assertUser(principal: AuthPrincipal): string {
  if (principal.type !== 'user') {
    throw i18nError.unauthorized(ERROR_KEYS.AUTH_UNAUTHENTICATED);
  }
  return principal.id;
}
