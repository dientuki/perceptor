import { Resolver, Query } from '@nestjs/graphql';
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
}
