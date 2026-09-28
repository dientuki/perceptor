import { Resolver, Query, Args, Int } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { IndexerService } from './indexer.service';
import { RankingContextService, SearchTarget } from './ranking-context.service';
import { TorrentResult } from './entities/torrent-result.entity';
import { IndexerStatus } from './entities/indexer-status.entity';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import type { AuthPrincipal } from '@/auth/auth.types';
import { i18nError } from '@/i18n/i18n-error';
import { ERROR_KEYS } from '@/i18n/error-keys';
import { AdminGuard } from '@/auth/guards/admin.guard';

@Resolver(() => TorrentResult)
export class IndexerResolver {
  constructor(
    private readonly indexerService: IndexerService,
    private readonly rankingContext: RankingContextService,
  ) {}

  @Query(() => [TorrentResult], {
    name: 'searchTorrents',
    description: 'Busca releases en el indexer (Prowlarr)',
  })
  async searchTorrents(
    @Args('query', { type: () => String }) query: string,
    @CurrentUser() principal: AuthPrincipal,
    @Args('movieId', { type: () => Int, nullable: true }) movieId?: number,
    @Args('seasonId', { type: () => Int, nullable: true }) seasonId?: number,
    @Args('episodeId', { type: () => Int, nullable: true }) episodeId?: number,
  ) {
    const given = [movieId, seasonId, episodeId].filter((id) => id != null);
    if (given.length > 1) {
      throw i18nError.badRequest(ERROR_KEYS.SEARCH_TARGET_AMBIGUOUS);
    }

    let target: SearchTarget = null;
    if (movieId != null) target = { movieId };
    else if (seasonId != null) target = { seasonId };
    else if (episodeId != null) target = { episodeId };

    const userId = principal.type === 'user' ? principal.id : '';
    const context = await this.rankingContext.forCaller(userId, target);
    return this.indexerService.searchRanked(query, context);
  }

  @UseGuards(AdminGuard)
  @Query(() => IndexerStatus, {
    name: 'indexerStatus',
    description:
      'How many indexers the configured Prowlarr holds, and whether Prowlarr answered at all.',
  })
  indexerStatus(): Promise<IndexerStatus> {
    return this.indexerService.status();
  }
}
