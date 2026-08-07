import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';
import { MediaSourcesService } from './media-sources.service';
import { MediaSource } from './entities/media-source.entity';
import { SourceFileInput } from './dto/source-file.input';

@Resolver(() => MediaSource)
export class MediaSourcesResolver {
  constructor(private readonly mediaSourcesService: MediaSourcesService) {}

  @Query(() => MediaSource, { name: 'mediaSource', nullable: true })
  async mediaSource(@Args('id', { type: () => Int }) id: number) {
    return this.mediaSourcesService.findOne(id);
  }

  @Mutation(() => MediaSource, {
    name: 'sourceScanned',
    description: 'El worker reporta el inventario de archivos de un MediaSource ya descargado',
  })
  async sourceScanned(
    @Args('mediaSourceId', { type: () => Int }) mediaSourceId: number,
    @Args('files', { type: () => [SourceFileInput] }) files: SourceFileInput[],
    @Args('matchedFilePath', { type: () => String, nullable: true }) matchedFilePath: string | null,
  ) {
    return this.mediaSourcesService.sourceScanned(mediaSourceId, files, matchedFilePath);
  }
}
