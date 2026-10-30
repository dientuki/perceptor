import { UseGuards } from '@nestjs/common';
import {
  Args,
  Context,
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
import { AdminGuard } from '@/auth/guards/admin.guard';
import type { AuthPrincipal } from '@/auth/auth.types';
import { i18nError } from '@/i18n/i18n-error';
import { ERROR_KEYS } from '@/i18n/error-keys';
import { Movie } from '@/movies/entities/movies.entity';
import { Episode } from '@/shows/entities/episode.entity';
import { SubtitleEmbedInput } from './dto/subtitle-embed.input';
import { ExternalSubtitle } from './entities/external-subtitle.entity';
import { SubtitleEmbed } from './entities/subtitle-embed.entity';
import { SubtitleSyncReference } from '@/subtitle-search/entities/subtitle-search.entity';
import { SubtitleEmbedSyncDetails } from './entities/subtitle-embed-sync-details.entity';
import { SubtitleEmbedSyncService } from './subtitle-embed-sync.service';
import { SubtitleEmbedDetails } from './entities/subtitle-embed-details.entity';
import {
  SubtitleEmbedRequestMemo,
  SubtitleEmbedService,
  newRequestMemo,
} from './subtitle-embed.service';

const MEMO_KEY = 'subtitleEmbedMemo';

// Spec 101, NFR-2
function memoOf(context: Record<string, unknown>): SubtitleEmbedRequestMemo {
  const existing = context[MEMO_KEY] as SubtitleEmbedRequestMemo | undefined;
  if (existing) return existing;
  const created = newRequestMemo();
  context[MEMO_KEY] = created;
  return created;
}

// Spec 101, REQ-1 REQ-17
@Resolver(() => Movie)
export class MovieSubtitleEmbedFieldsResolver {
  constructor(private readonly service: SubtitleEmbedService) {}

  @ResolveField(() => [ExternalSubtitle], {
    description:
      'Empty unless the caller is an administrator and Jellyfin answers (REQ-2).',
  })
  externalSubtitles(
    @Parent() movie: Movie,
    @CurrentUser() principal: AuthPrincipal,
    @Context() context: Record<string, unknown>,
  ) {
    return this.service.externalSubtitlesForMovie(
      Number(movie.id),
      principal,
      memoOf(context),
    );
  }

  @ResolveField(() => SubtitleEmbed, {
    nullable: true,
    description: "The film's most recent embed, null if it never had one.",
  })
  subtitleEmbed(@Parent() movie: Movie) {
    return this.service.latestEmbedForMovie(Number(movie.id));
  }
}

// Spec 101, REQ-1 REQ-17
@Resolver(() => Episode)
export class EpisodeSubtitleEmbedFieldsResolver {
  constructor(private readonly service: SubtitleEmbedService) {}

  @ResolveField(() => [ExternalSubtitle])
  externalSubtitles(
    @Parent() episode: Episode,
    @CurrentUser() principal: AuthPrincipal,
    @Context() context: Record<string, unknown>,
  ) {
    return this.service.externalSubtitlesForEpisode(
      Number(episode.id),
      principal,
      memoOf(context),
    );
  }

  @ResolveField(() => SubtitleEmbed, { nullable: true })
  subtitleEmbed(@Parent() episode: Episode) {
    return this.service.latestEmbedForEpisode(Number(episode.id));
  }
}

// Spec 101, REQ-3
@Resolver()
export class SubtitleEmbedResolver {
  constructor(
    private readonly service: SubtitleEmbedService,
    private readonly syncService: SubtitleEmbedSyncService,
  ) {}

  @UseGuards(AdminGuard)
  @Mutation(() => SubtitleEmbed, { name: 'embedMovieSubtitles' })
  embedMovieSubtitles(
    @Args('movieId', { type: () => Int }) movieId: number,
    @Args('subtitles', { type: () => [SubtitleEmbedInput] })
    subtitles: SubtitleEmbedInput[],
    @CurrentUser() principal: AuthPrincipal,
  ) {
    return this.service.embedMovie(movieId, subtitles, userIdOf(principal));
  }

  @UseGuards(AdminGuard)
  @Mutation(() => SubtitleEmbed, { name: 'embedEpisodeSubtitles' })
  embedEpisodeSubtitles(
    @Args('episodeId', { type: () => Int }) episodeId: number,
    @Args('subtitles', { type: () => [SubtitleEmbedInput] })
    subtitles: SubtitleEmbedInput[],
    @CurrentUser() principal: AuthPrincipal,
  ) {
    return this.service.embedEpisode(episodeId, subtitles, userIdOf(principal));
  }

  @AllowService()
  @Mutation(() => Boolean, {
    name: 'subtitleEmbedStarted',
    description:
      'Service-only (worker). Moves a QUEUED embed to RUNNING; false if it is no longer QUEUED.',
  })
  subtitleEmbedStarted(
    @Args('id', { type: () => Int }) id: number,
    @CurrentUser() principal: AuthPrincipal,
  ) {
    assertService(principal);
    return this.service.started(id);
  }

  @AllowService()
  @Mutation(() => Boolean, {
    name: 'subtitleEmbedCompleted',
    description:
      "Service-only (worker). Safe to receive more than once (038's posture). warningKey is null or error.subtitleEmbed.sidecar_delete_failed.",
  })
  subtitleEmbedCompleted(
    @Args('id', { type: () => Int }) id: number,
    @Args('warningKey', { type: () => String, nullable: true })
    warningKey: string | null | undefined,
    @CurrentUser() principal: AuthPrincipal,
  ) {
    assertService(principal);
    return this.service.completed(id, warningKey ?? null);
  }

  @AllowService()
  @Mutation(() => Boolean, {
    name: 'subtitleEmbedFailed',
    description: 'Service-only (worker). Safe to receive more than once.',
  })
  subtitleEmbedFailed(
    @Args('id', { type: () => Int }) id: number,
    @Args('errorKey') errorKey: string,
    @CurrentUser() principal: AuthPrincipal,
  ) {
    assertService(principal);
    return this.service.failed(id, errorKey);
  }

  @AllowService()
  @Query(() => SubtitleEmbedDetails, {
    name: 'subtitleEmbedDetails',
    description:
      "Service-only (worker). Container paths, same standing as EncodeJobDetails' outputRoot. Answers for any status.",
  })
  subtitleEmbedDetails(
    @Args('id', { type: () => Int }) id: number,
    @CurrentUser() principal: AuthPrincipal,
  ) {
    assertService(principal);
    return this.service.details(id);
  }

  // Spec 113, REQ-3
  @AllowService()
  @Query(() => SubtitleEmbedSyncDetails, {
    name: 'subtitleEmbedSyncDetails',
    description:
      'Service-only (worker). Refused with error.subtitleEmbed.sync_not_found unless the embed is SYNCING and fileName is one of its automatic tracks.',
  })
  subtitleEmbedSyncDetails(
    @Args('subtitleEmbedId', { type: () => Int }) subtitleEmbedId: number,
    @Args('fileName') fileName: string,
    @CurrentUser() principal: AuthPrincipal,
  ) {
    assertService(principal);
    return this.syncService.details(subtitleEmbedId, fileName);
  }

  // Spec 113, REQ-4
  @AllowService()
  @Mutation(() => Boolean, {
    name: 'subtitleEmbedSyncCompleted',
    description:
      'Service-only (worker). Same arguments as subtitleSyncCompleted. Safe to receive more than once; false when the embed is no longer SYNCING.',
  })
  subtitleEmbedSyncCompleted(
    @Args('subtitleEmbedId', { type: () => Int }) subtitleEmbedId: number,
    @Args('fileName') fileName: string,
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
    return this.syncService.completed(subtitleEmbedId, fileName, {
      offsetMs,
      framerateRatio,
      reference,
      score,
      mediaDurationMs,
      lastChapterStartMs: lastChapterStartMs ?? null,
    });
  }

  // Spec 113, REQ-5
  @AllowService()
  @Mutation(() => Boolean, {
    name: 'subtitleEmbedSyncFailed',
    description:
      'Service-only (worker). Safe to receive more than once; false when the embed is no longer SYNCING.',
  })
  subtitleEmbedSyncFailed(
    @Args('subtitleEmbedId', { type: () => Int }) subtitleEmbedId: number,
    @Args('fileName') fileName: string,
    @Args('errorKey') errorKey: string,
    @CurrentUser() principal: AuthPrincipal,
  ) {
    assertService(principal);
    return this.syncService.failed(subtitleEmbedId, fileName, errorKey);
  }
}

function assertService(principal: AuthPrincipal): void {
  if (principal.type !== 'service') {
    throw i18nError.unauthorized(ERROR_KEYS.AUTH_UNAUTHENTICATED);
  }
}

function userIdOf(principal: AuthPrincipal): string {
  if (principal.type !== 'user') {
    throw i18nError.unauthorized(ERROR_KEYS.AUTH_UNAUTHENTICATED);
  }
  return principal.id;
}
