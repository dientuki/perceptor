import { Resolver, Query, Mutation, ResolveField, Parent, Args, Int } from '@nestjs/graphql';
import { NotFoundException } from '@nestjs/common';
import { ShowsService } from './shows.service';
import { Show } from './entities/show.entity';
import { Language } from '@/languages/entities/language.entity';
import { LanguagesService } from '@/languages/languages.service';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import type { AuthPrincipal } from '@/auth/auth.types';

@Resolver(() => Show)
export class ShowsResolver {
  constructor(
    private readonly showsService: ShowsService,
    private readonly languagesService: LanguagesService,
  ) {}

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

  // The calling user's own per-title preference (011-av1-transcode). Only
  // runs when the client selects the field — see the same note on
  // Show.preferredLanguages in show.entity.ts, and 011's plan.md risk on
  // N+1 listings.
  @ResolveField(() => [Language])
  async preferredLanguages(@Parent() show: Show, @CurrentUser() principal: AuthPrincipal) {
    const userId = principal.type === 'user' ? principal.id : '';
    return this.languagesService.findShowPreferredLanguagesFor(userId, show.id);
  }

  // Replaces the authenticated user's per-title preference for one series —
  // refused, unchanged, on a series the caller does not own (see
  // ShowsService.findOneFromDb and 009-show-detail's frozen error message).
  @Mutation(() => [Language], {
    name: 'setShowPreferredLanguages',
    description: 'Reemplaza la preferencia de idiomas del usuario para una serie puntual',
  })
  async setShowPreferredLanguages(
    @Args('showId', { type: () => Int }) showId: number,
    @Args('iso2', { type: () => [String] }) iso2: string[],
    @CurrentUser() principal: AuthPrincipal,
  ) {
    const userId = principal.type === 'user' ? principal.id : '';
    // findOneFromDb returns null rather than throwing (it also backs the
    // nullable `show(id)` query above) — the mutation is where that null
    // becomes the refusal 009-show-detail already froze for this resource.
    const show = await this.showsService.findOneFromDb(showId, userId);
    if (!show) throw new NotFoundException('Recurso no disponible para este usuario');
    return this.languagesService.setShowPreferredLanguagesFor(userId, showId, iso2);
  }
}
