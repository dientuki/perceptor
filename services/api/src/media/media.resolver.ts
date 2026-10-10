import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';
import { MediaDispatchService } from './media-dispatch.service';
import { MediaSearchService } from './media-search.service';
import { PopularMediaService } from './popular-media.service';
import { MediaCapabilitiesService } from './media-capabilities.service';
import { MediaSearchResult } from './entities/media-search-result.entity';
import { MediaRef } from './entities/media-ref.entity';
import { MediaCapabilities } from './entities/media-capabilities.entity';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import type { AuthPrincipal } from '@/auth/auth.types';

@Resolver()
export class MediaResolver {
  constructor(
    private readonly mediaDispatch: MediaDispatchService,
    private readonly mediaSearch: MediaSearchService,
    private readonly popularMediaService: PopularMediaService,
    private readonly mediaCapabilitiesService: MediaCapabilitiesService,
  ) {}

  // Spec 045, REQ-1 REQ-12 NFR-2
  @Query(() => MediaCapabilities, { name: 'mediaCapabilities' })
  async mediaCapabilities(): Promise<MediaCapabilities> {
    return this.mediaCapabilitiesService.read();
  }

  // Spec 006, NFR-7
  @Query(() => [MediaSearchResult], { name: 'searchMedia' })
  async searchMedia(
    @Args('query') query: string,
    @Args('type') type: string,
    @CurrentUser() principal: AuthPrincipal,
  ) {
    await this.mediaCapabilitiesService.assertEnabled(type);
    const userId = principal.type === 'user' ? principal.id : '';
    return this.mediaDispatch.resolve(type).search(query, userId);
  }

  // Spec 026, NFR-5
  @Query(() => [MediaSearchResult], { name: 'searchAllMedia' })
  async searchAllMedia(
    @Args('query') query: string,
    @CurrentUser() principal: AuthPrincipal,
  ) {
    const userId = principal.type === 'user' ? principal.id : '';
    return this.mediaSearch.searchAll(query, userId);
  }

  // Spec 033, NFR-2
  @Query(() => [MediaSearchResult], { name: 'popularMedia' })
  async popularMedia(
    @Args('type') type: string,
    @CurrentUser() principal: AuthPrincipal,
  ) {
    await this.mediaCapabilitiesService.assertEnabled(type);
    const userId = principal.type === 'user' ? principal.id : '';
    return this.popularMediaService.list(type, userId);
  }

  @Mutation(() => MediaRef, { name: 'addMedia' })
  async addMedia(
    @Args('tmdbId', { type: () => Int }) tmdbId: number,
    @Args('type') type: string,
    @CurrentUser() principal: AuthPrincipal,
  ) {
    await this.mediaCapabilitiesService.assertEnabled(type);
    const userId = principal.type === 'user' ? principal.id : '';
    return this.mediaDispatch.resolve(type).register(tmdbId, userId);
  }
}
