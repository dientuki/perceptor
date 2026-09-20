import { Resolver, Query, Mutation, Args, Int, ResolveField, Parent } from '@nestjs/graphql';
import { MediaSourcesService } from './media-sources.service';
import { MediaSource } from './entities/media-source.entity';
import { SourceFileInput } from './dto/source-file.input';
import { ScannedMatchInput } from './dto/scanned-match.input';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import type { AuthPrincipal } from '@/auth/auth.types';
import { i18nError } from '@/i18n/i18n-error';
import { ERROR_KEYS } from '@/i18n/error-keys';
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

  @AllowService()
  @Mutation(() => Boolean, {
    name: 'sourceScanFailed',
    description: 'The worker reports that scanning a downloaded MediaSource failed',
  })
  async sourceScanFailed(
    @CurrentUser() principal: AuthPrincipal,
    @Args('mediaSourceId', { type: () => Int }) mediaSourceId: number,
    @Args('errorKey') errorKey: string,
    @Args('errorParams', { type: () => String, nullable: true }) errorParams: string | null,
    @Args('errorMessage') errorMessage: string,
  ) {
    if (principal.type !== 'service') {
      throw i18nError.unauthorized(ERROR_KEYS.AUTH_UNAUTHENTICATED);
    }
    return this.mediaSourcesService.sourceScanFailed(mediaSourceId, errorKey, errorParams, errorMessage);
  }
}
