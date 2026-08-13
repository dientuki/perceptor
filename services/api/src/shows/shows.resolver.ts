import { Resolver, Query, Args, Int } from '@nestjs/graphql';
import { ShowsService } from './shows.service';
import { Show } from './entities/show.entity';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import type { AuthPrincipal } from '@/auth/auth.types';

@Resolver(() => Show)
export class ShowsResolver {
  constructor(private readonly showsService: ShowsService) {}

  // Direct query against the DB (MariaDB / Prisma), scoped to the caller's
  // own library. The global JwtAuthGuard already requires a credential; none
  // of these operations carry @AllowService(), so principal should always be
  // 'user' — narrowed anyway, for structural safety (see auth.types.ts). The
  // empty-string fallback is what makes a service principal resolve to an
  // empty library instead of everyone's series.
  @Query(() => [Show], { name: 'shows' })
  async getShows(@CurrentUser() principal: AuthPrincipal) {
    const userId = principal.type === 'user' ? principal.id : '';
    return this.showsService.findAll(userId);
  }

  // Single series by internal DB id, scoped to the caller's own library —
  // same shape as MoviesResolver.getMovieById (008-movie-detail): null now
  // means "not available to you", identically for a missing id and an
  // unowned series (see spec.md's 009-show-detail § Errors).
  @Query(() => Show, { name: 'show', nullable: true })
  async getShowById(@Args('id', { type: () => Int }) id: number, @CurrentUser() principal: AuthPrincipal) {
    const userId = principal.type === 'user' ? principal.id : '';
    return this.showsService.findOneFromDb(id, userId);
  }
}
