import { Resolver, Query, Mutation, Args, Int, ResolveField, Parent } from '@nestjs/graphql';
import { MediaSourcesService } from './media-sources.service';
import { MediaSource } from './entities/media-source.entity';
import { SourceFileInput } from './dto/source-file.input';
import { ScannedMatchInput } from './dto/scanned-match.input';
import { AllowService } from '@/auth/decorators/allow-service.decorator';

@Resolver(() => MediaSource)
export class MediaSourcesResolver {
  constructor(private readonly mediaSourcesService: MediaSourcesService) {}

  @AllowService()
  @Query(() => MediaSource, { name: 'mediaSource', nullable: true })
  async mediaSource(@Args('id', { type: () => Int }) id: number) {
    return this.mediaSourcesService.findOne(id);
  }

  // Resolved on demand (NFR-1): one torrent-client call per caller that asks
  // for this field, never eagerly inside findOne/sourceScanned. The parent is
  // the Prisma row findOneFlat returns, so infoHash is already in hand — no
  // second query. Typed locally against what the service actually needs, not
  // against the MediaSource @ObjectType, which does not expose infoHash.
  @ResolveField(() => [String], { nullable: true })
  async downloadedFiles(@Parent() source: { infoHash: string | null }) {
    return this.mediaSourcesService.downloadedFiles(source);
  }

  @AllowService()
  @Mutation(() => MediaSource, {
    name: 'sourceScanned',
    description: 'El worker reporta el inventario de archivos de un MediaSource ya descargado',
  })
  async sourceScanned(
    @Args('mediaSourceId', { type: () => Int }) mediaSourceId: number,
    @Args('files', { type: () => [SourceFileInput] }) files: SourceFileInput[],
    @Args('matches', { type: () => [ScannedMatchInput] }) matches: ScannedMatchInput[],
  ) {
    return this.mediaSourcesService.sourceScanned(mediaSourceId, files, matches);
  }
}
