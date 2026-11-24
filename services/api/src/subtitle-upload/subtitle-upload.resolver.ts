import { Args, Int, Mutation, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import type { AuthPrincipal } from '@/auth/auth.types';
import { ERROR_KEYS } from '@/i18n/error-keys';
import { i18nError } from '@/i18n/i18n-error';
import { SubtitleEmbed } from '@/subtitle-embed/entities/subtitle-embed.entity';
import { SubtitleUploadInput } from './dto/subtitle-upload.input';
import { SubtitleUploadService } from './subtitle-upload.service';

// Spec 124, REQ-2
@Resolver()
export class SubtitleUploadResolver {
  constructor(private readonly service: SubtitleUploadService) {}

  @Mutation(() => SubtitleEmbed, {
    name: 'uploadMovieSubtitles',
    description: 'Owner of the film. Returns the new embed, SYNCING or QUEUED.',
  })
  uploadMovieSubtitles(
    @Args('movieId', { type: () => Int }) movieId: number,
    @Args('subtitles', { type: () => [SubtitleUploadInput] })
    subtitles: SubtitleUploadInput[],
    @CurrentUser() principal: AuthPrincipal,
  ) {
    return this.service.upload(
      { kind: 'movie', id: movieId },
      subtitles,
      userIdOf(principal),
    );
  }

  @Mutation(() => SubtitleEmbed, {
    name: 'uploadEpisodeSubtitles',
    description:
      "Owner of the episode's series. Returns the new embed, SYNCING or QUEUED.",
  })
  uploadEpisodeSubtitles(
    @Args('episodeId', { type: () => Int }) episodeId: number,
    @Args('subtitles', { type: () => [SubtitleUploadInput] })
    subtitles: SubtitleUploadInput[],
    @CurrentUser() principal: AuthPrincipal,
  ) {
    return this.service.upload(
      { kind: 'episode', id: episodeId },
      subtitles,
      userIdOf(principal),
    );
  }
}

function userIdOf(principal: AuthPrincipal): string {
  if (principal.type !== 'user') {
    throw i18nError.unauthorized(ERROR_KEYS.AUTH_UNAUTHENTICATED);
  }
  return principal.id;
}
