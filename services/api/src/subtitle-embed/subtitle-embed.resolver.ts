import { UseGuards } from '@nestjs/common';
import {
  Args,
  Context,
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
  constructor(private readonly service: SubtitleEmbedService) {}

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
