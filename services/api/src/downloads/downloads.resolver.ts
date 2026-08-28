import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';
import { DownloadsService } from '@/downloads/downloads.service';
import { Download } from '@/downloads/entities/download.entity';
import { AllowService } from '@/auth/decorators/allow-service.decorator';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import type { AuthPrincipal } from '@/auth/auth.types';

// Canal de aviso qBittorrent -> api, más el read/control surface de
// 022-download-status-tags (REQ-8 a REQ-19). La lógica vive en
// DownloadsService; el resolver sólo delega.
@Resolver()
export class DownloadsResolver {
  constructor(private readonly downloadsService: DownloadsService) {}

  // Called with the machine credential from the qBittorrent AutoRun hook,
  // not the worker — same SERVICE_TOKEN, different caller.
  @AllowService()
  @Mutation(() => String, {
    name: 'torrentCompleted',
    description: 'Aviso del cliente de torrents de que una descarga terminó',
  })
  async torrentCompleted(@Args('infoHash') infoHash: string): Promise<string> {
    return this.downloadsService.handleTorrentCompleted(infoHash);
  }

  // No @AllowService() — REQ-17: resolves through the same ownership clause
  // as movie(id), and answers a title the caller does not own exactly as it
  // answers one that does not exist. The global JwtAuthGuard already
  // requires a credential, so principal should always be 'user' — narrowed
  // anyway, for structural safety (see auth.types.ts).
  @Query(() => [Download], { name: 'movieDownloads' })
  async movieDownloads(
    @Args('movieId', { type: () => Int }) movieId: number,
    @CurrentUser() principal: AuthPrincipal,
  ): Promise<Download[]> {
    const userId = principal.type === 'user' ? principal.id : '';
    return this.downloadsService.movieDownloads(movieId, userId);
  }

  @Query(() => [Download], { name: 'showDownloads' })
  async showDownloads(
    @Args('showId', { type: () => Int }) showId: number,
    @CurrentUser() principal: AuthPrincipal,
  ): Promise<Download[]> {
    const userId = principal.type === 'user' ? principal.id : '';
    return this.downloadsService.showDownloads(showId, userId);
  }

  @Mutation(() => Download, {
    name: 'downloadStart',
    description: 'Reanuda un torrent en el cliente de torrents (resume, no force start)',
  })
  async downloadStart(
    @Args('mediaSourceId', { type: () => Int }) mediaSourceId: number,
    @CurrentUser() principal: AuthPrincipal,
  ): Promise<Download> {
    const userId = principal.type === 'user' ? principal.id : '';
    return this.downloadsService.downloadStart(mediaSourceId, userId);
  }

  @Mutation(() => Download, {
    name: 'downloadStop',
    description: 'Detiene un torrent en el cliente de torrents',
  })
  async downloadStop(
    @Args('mediaSourceId', { type: () => Int }) mediaSourceId: number,
    @CurrentUser() principal: AuthPrincipal,
  ): Promise<Download> {
    const userId = principal.type === 'user' ? principal.id : '';
    return this.downloadsService.downloadStop(mediaSourceId, userId);
  }

  // Not downloadRemove: this is the user-facing sibling — ownership-scoped,
  // no deleteFiles argument, always deletes files, returns a boolean. See
  // ../../../docs/spec/features/022-download-status-tags/spec.md § GraphQL
  // Contract Delta notes for why the two must never be implemented in terms
  // of each other's arguments.
  @Mutation(() => Boolean, {
    name: 'downloadDelete',
    description: 'Borra un torrent del cliente de torrents junto con sus archivos, y su fila',
  })
  async downloadDelete(
    @Args('mediaSourceId', { type: () => Int }) mediaSourceId: number,
    @CurrentUser() principal: AuthPrincipal,
  ): Promise<boolean> {
    const userId = principal.type === 'user' ? principal.id : '';
    return this.downloadsService.downloadDelete(mediaSourceId, userId);
  }
}
