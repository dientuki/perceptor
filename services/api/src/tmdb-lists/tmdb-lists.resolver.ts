import { UseGuards } from '@nestjs/common';
import {
  Resolver,
  Query,
  Mutation,
  Args,
  Int,
  ResolveField,
  Parent,
} from '@nestjs/graphql';

import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import type { AuthPrincipal } from '@/auth/auth.types';
import { i18nError } from '@/i18n/i18n-error';
import { ERROR_KEYS } from '@/i18n/error-keys';

import { Movie } from '@/movies/entities/movies.entity';
import { Show } from '@/shows/entities/show.entity';
import { TmdbList } from './entities/tmdb-list.entity';
import { TmdbListsService } from './tmdb-lists.service';

// Spec 109, REQ-1 REQ-3 REQ-4
@Resolver(() => TmdbList)
export class TmdbListsResolver {
  constructor(private readonly service: TmdbListsService) {}

  @UseGuards(JwtAuthGuard)
  @Query(() => [TmdbList])
  async tmdbLists(
    @CurrentUser() principal: AuthPrincipal,
  ): Promise<TmdbList[]> {
    return this.service.listFor(this.userId(principal));
  }

  // Spec 109, REQ-14
  @UseGuards(JwtAuthGuard)
  @Query(() => TmdbList, {
    nullable: true,
    description:
      'One of the caller\'s lists; null for an id that is not theirs (109 0.2.0).',
  })
  async tmdbList(
    @CurrentUser() principal: AuthPrincipal,
    @Args('id', { type: () => Int }) id: number,
  ): Promise<TmdbList | null> {
    return this.service.findOneFor(this.userId(principal), id);
  }

  // Spec 109, REQ-14
  @ResolveField(() => [Movie], {
    description:
      'Films of this list the caller owns today (seen by the list), ordered by title.',
  })
  async movies(
    @Parent() list: TmdbList,
    @CurrentUser() principal: AuthPrincipal,
  ) {
    return this.service.ownedTitles(this.userId(principal), list.id, 'movie');
  }

  // Spec 109, REQ-14
  @ResolveField(() => [Show], {
    description:
      'Series of this list the caller owns today (seen by the list), ordered by title.',
  })
  async shows(
    @Parent() list: TmdbList,
    @CurrentUser() principal: AuthPrincipal,
  ) {
    return this.service.ownedTitles(this.userId(principal), list.id, 'show');
  }

  @UseGuards(JwtAuthGuard)
  @Mutation(() => TmdbList)
  async addTmdbList(
    @CurrentUser() principal: AuthPrincipal,
    @Args('reference') reference: string,
  ): Promise<TmdbList> {
    return this.service.attach(this.userId(principal), reference);
  }

  @UseGuards(JwtAuthGuard)
  @Mutation(() => Boolean)
  async removeTmdbList(
    @CurrentUser() principal: AuthPrincipal,
    @Args('id', { type: () => Int }) id: number,
  ): Promise<boolean> {
    return this.service.detach(this.userId(principal), id);
  }

  private userId(principal: AuthPrincipal): string {
    if (principal.type !== 'user') {
      throw i18nError.unauthorized(ERROR_KEYS.AUTH_UNAUTHENTICATED);
    }
    return principal.id;
  }
}
