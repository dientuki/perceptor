import { Resolver, Mutation, Args, Int } from '@nestjs/graphql';
import { EpisodesService } from './episodes.service';
import { Episode } from '@/shows/entities/episode.entity';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import type { AuthPrincipal } from '@/auth/auth.types';

// No queries here — show(id) already returns every episode nested under its
// seasons (009-show-detail). Neither mutation carries @AllowService(): no
// worker/machine caller needs them, and adding the grant now would open an
// unscoped write path with zero consumers (see spec.md's 010-episode-
// acquisition § GraphQL Contract Delta).
@Resolver(() => Episode)
export class EpisodesResolver {
  constructor(private readonly episodesService: EpisodesService) {}

  @Mutation(() => Episode, {
    name: 'addTorrentToEpisode',
    description: 'Envía un release elegido a qBittorrent y lo asocia al episodio',
  })
  async addTorrentToEpisode(
    @Args('episodeId', { type: () => Int }) episodeId: number,
    @Args('infoHash') infoHash: string,
    @Args('urls', { type: () => [String] }) urls: string[],
    @Args('releaseTitle', { type: () => String, nullable: true }) releaseTitle: string | null,
    @Args('force', { type: () => Boolean, nullable: true, defaultValue: false }) force: boolean,
    @CurrentUser() principal: AuthPrincipal,
  ) {
    // The global JwtAuthGuard already requires a credential and this
    // operation carries no @AllowService(), so principal should always be
    // 'user' — narrowed anyway, for structural safety (see auth.types.ts).
    const userId = principal.type === 'user' ? principal.id : '';
    return this.episodesService.addTorrentToEpisode(episodeId, { infoHash, urls, releaseTitle, force }, userId);
  }

  @Mutation(() => Episode, {
    name: 'addMagnetToEpisode',
    description: 'Manda un magnet pegado por el usuario a qBittorrent y lo asocia al episodio',
  })
  async addMagnetToEpisode(
    @Args('episodeId', { type: () => Int }) episodeId: number,
    @Args('magnet') magnet: string,
    @Args('force', { type: () => Boolean, nullable: true, defaultValue: false }) force: boolean,
    @CurrentUser() principal: AuthPrincipal,
  ) {
    const userId = principal.type === 'user' ? principal.id : '';
    return this.episodesService.addMagnetToEpisode(episodeId, { magnet, force }, userId);
  }
}
