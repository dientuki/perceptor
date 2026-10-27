import { Args, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { AllowService } from '@/auth/decorators/allow-service.decorator';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import type { AuthPrincipal } from '@/auth/auth.types';
import { i18nError } from '@/i18n/i18n-error';
import { ERROR_KEYS } from '@/i18n/error-keys';
import { Movie } from '@/movies/entities/movies.entity';
import { Episode } from '@/shows/entities/episode.entity';
import { LibraryProbeService } from './library-probe.service';
import { LibraryProbeTarget } from './dto/library-probe-target.input';
import { LibraryProbeDetails } from './entities/library-probe-details.entity';

const asLanguages = (value: unknown): string[] | null =>
  Array.isArray(value) ? value.map(String) : null;

const FILE_AUDIO_DESCRIPTION =
  'ISO 639-2 audio languages of the library file (108 REQ-1); null while the file has never been read.';
const FILE_SUBTITLE_DESCRIPTION =
  'ISO 639-2 subtitle languages of the library file, embedded and sidecar (108 REQ-1); null while the file has never been read.';

// Spec 108, REQ-1
@Resolver(() => Movie)
export class MovieLibraryTracksResolver {
  @ResolveField(() => [String], {
    nullable: true,
    description: FILE_AUDIO_DESCRIPTION,
  })
  fileAudioLanguages(@Parent() movie: Record<string, unknown>) {
    return asLanguages(movie.fileAudioLanguages);
  }

  @ResolveField(() => [String], {
    nullable: true,
    description: FILE_SUBTITLE_DESCRIPTION,
  })
  fileSubtitleLanguages(@Parent() movie: Record<string, unknown>) {
    return asLanguages(movie.fileSubtitleLanguages);
  }
}

// Spec 108, REQ-1
@Resolver(() => Episode)
export class EpisodeLibraryTracksResolver {
  @ResolveField(() => [String], {
    nullable: true,
    description: FILE_AUDIO_DESCRIPTION,
  })
  fileAudioLanguages(@Parent() episode: Record<string, unknown>) {
    return asLanguages(episode.fileAudioLanguages);
  }

  @ResolveField(() => [String], {
    nullable: true,
    description: FILE_SUBTITLE_DESCRIPTION,
  })
  fileSubtitleLanguages(@Parent() episode: Record<string, unknown>) {
    return asLanguages(episode.fileSubtitleLanguages);
  }
}

// Spec 108, REQ-2 REQ-5
@Resolver()
export class LibraryProbeResolver {
  constructor(private readonly service: LibraryProbeService) {}

  @AllowService()
  @Query(() => LibraryProbeDetails, {
    name: 'libraryProbeDetails',
    description: 'Service-only (worker). Exactly one of movieId/episodeId is set.',
  })
  libraryProbeDetails(
    @Args('target', { type: () => LibraryProbeTarget })
    target: LibraryProbeTarget,
    @CurrentUser() principal: AuthPrincipal,
  ) {
    assertService(principal);
    return this.service.details(target);
  }

  @AllowService()
  @Mutation(() => Boolean, {
    name: 'libraryProbeCompleted',
    description:
      'Service-only (worker). Safe to receive more than once; false when filePath is no longer the title\'s file and the report was discarded (108 REQ-5).',
  })
  libraryProbeCompleted(
    @Args('target', { type: () => LibraryProbeTarget })
    target: LibraryProbeTarget,
    @Args('filePath', {
      description: 'The path that was read, as libraryProbeDetails returned it.',
    })
    filePath: string,
    @Args('audioLanguagesIso3', {
      type: () => [String],
      description: 'ISO 639-2 codes of the audio tracks, und and untagged left out.',
    })
    audioLanguagesIso3: string[],
    @Args('embeddedSubtitleLanguagesIso3', {
      type: () => [String],
      description: 'ISO 639-2 codes of the embedded subtitle tracks (108 REQ-1).',
    })
    embeddedSubtitleLanguagesIso3: string[],
    @Args('sidecarLanguageTags', {
      type: () => [String],
      description:
        'Language tags of the sidecars, as written in their names; api resolves them.',
    })
    sidecarLanguageTags: string[],
    @CurrentUser() principal: AuthPrincipal,
  ) {
    assertService(principal);
    return this.service.completed(
      target,
      filePath,
      audioLanguagesIso3,
      embeddedSubtitleLanguagesIso3,
      sidecarLanguageTags,
    );
  }
}

function assertService(principal: AuthPrincipal): void {
  if (principal.type !== 'service') {
    throw i18nError.unauthorized(ERROR_KEYS.AUTH_UNAUTHENTICATED);
  }
}
