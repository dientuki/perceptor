import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';
import { MediaDispatchService } from './media-dispatch.service';
import { MediaSearchService } from './media-search.service';
import { MediaSearchResult } from './entities/media-search-result.entity';
import { MediaRef } from './entities/media-ref.entity';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import type { AuthPrincipal } from '@/auth/auth.types';

@Resolver()
export class MediaResolver {
  constructor(
    private readonly mediaDispatch: MediaDispatchService,
    private readonly mediaSearch: MediaSearchService,
  ) {}

  // The global JwtAuthGuard already requires a credential; neither operation
  // here carries @AllowService(), so principal should always be 'user' —
  // narrowed anyway, for structural safety (see auth.types.ts). Deliberately
  // not exempted for the worker/qBittorrent credential (NFR-7).
  @Query(() => [MediaSearchResult], { name: 'searchMedia' })
  async searchMedia(
    @Args('query') query: string,
    @Args('type') type: string,
    @CurrentUser() principal: AuthPrincipal,
  ) {
    const userId = principal.type === 'user' ? principal.id : '';
    return this.mediaDispatch.resolve(type).search(query, userId);
  }

  // Same auth shape as searchMedia above — no @AllowService() (NFR-5).
  @Query(() => [MediaSearchResult], { name: 'searchAllMedia' })
  async searchAllMedia(
    @Args('query') query: string,
    @CurrentUser() principal: AuthPrincipal,
  ) {
    const userId = principal.type === 'user' ? principal.id : '';
    return this.mediaSearch.searchAll(query, userId);
  }

  @Mutation(() => MediaRef, { name: 'addMedia' })
  async addMedia(
    @Args('tmdbId', { type: () => Int }) tmdbId: number,
    @Args('type') type: string,
    @CurrentUser() principal: AuthPrincipal,
  ) {
    const userId = principal.type === 'user' ? principal.id : '';
    return this.mediaDispatch.resolve(type).register(tmdbId, userId);
  }
}
