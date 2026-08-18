import { Resolver, Mutation, Args, Int } from '@nestjs/graphql';
import { SeasonsService } from './seasons.service';
import { Season } from '@/shows/entities/season.entity';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import type { AuthPrincipal } from '@/auth/auth.types';

// Structural twin of EpisodesResolver — see 013-season-pack-processing's
// api/plan.md § Approach for why this is not shared. No @AllowService()
// here either: this mutation exists so the season-pack pipeline is
// reachable and testable at all (013's own REQ-14), not for the worker.
@Resolver(() => Season)
export class SeasonsResolver {
  constructor(private readonly seasonsService: SeasonsService) {}

  @Mutation(() => Season, {
    name: 'addMagnetToSeason',
    description: 'Manda un magnet pegado por el usuario a qBittorrent y lo asocia a la temporada',
  })
  async addMagnetToSeason(
    @Args('seasonId', { type: () => Int }) seasonId: number,
    @Args('magnet') magnet: string,
    @Args('force', { type: () => Boolean, nullable: true, defaultValue: false }) force: boolean,
    @CurrentUser() principal: AuthPrincipal,
  ) {
    const userId = principal.type === 'user' ? principal.id : '';
    return this.seasonsService.addMagnetToSeason(seasonId, { magnet, force }, userId);
  }
}
