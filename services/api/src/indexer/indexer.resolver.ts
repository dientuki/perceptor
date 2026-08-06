import { Resolver, Query, Args } from '@nestjs/graphql';
import { IndexerService } from './indexer.service';
import { TorrentResult } from './entities/torrent-result.entity';

@Resolver(() => TorrentResult)
export class IndexerResolver {
  constructor(private readonly indexerService: IndexerService) {}

  @Query(() => [TorrentResult], {
    name: 'searchTorrents',
    description: 'Busca releases en el indexer (Prowlarr)',
  })
  async searchTorrents(@Args('query', { type: () => String }) query: string) {
    return this.indexerService.search(query);
  }
}
