import { UseGuards } from '@nestjs/common';
import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';
import { LanguageTrackKind as PrismaLanguageTrackKind } from '@prisma/client';

import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import { AdminGuard } from '@/auth/guards/admin.guard';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import type { AuthPrincipal } from '@/auth/auth.types';
import { i18nError } from '@/i18n/i18n-error';
import { ERROR_KEYS } from '@/i18n/error-keys';
import { Language } from '@/languages/entities/language.entity';
import { LanguagesService } from '@/languages/languages.service';

import { PreferencesService } from './preferences.service';
import { UserPreferences } from './entities/user-preferences.entity';
import { TorrentGroup } from './entities/torrent-group.entity';
import { TorrentGroupScope } from './entities/torrent-group-scope.enum';
import { LanguageTrackKind } from './entities/language-track-kind.enum';

// Most operations here are rooted at @CurrentUser() and reject a non-user
// principal the same way AuthResolver's setUiLocale/me do — no operation
// takes a user id and none carries @AllowService() (REQ-9). The two
// exceptions are createTorrentGroup and deleteTorrentGroup: they curate the
// shared catalog, not a caller's own selection, so they take AdminGuard
// instead and an id/name argument rather than @CurrentUser(). The
// torrentGroups query stays JwtAuthGuard-only despite sitting next to those
// two — /preferences (not an admin screen) is what reads it, so any
// signed-in user must be able to see the whole catalog to pick from it.
@Resolver()
export class PreferencesResolver {
  constructor(
    private readonly preferencesService: PreferencesService,
    private readonly languagesService: LanguagesService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Query(() => UserPreferences)
  async preferences(@CurrentUser() principal: AuthPrincipal): Promise<UserPreferences> {
    if (principal.type !== 'user') {
      throw i18nError.unauthorized(ERROR_KEYS.AUTH_UNAUTHENTICATED);
    }
    return this.preferencesService.findForUser(principal.id);
  }

  // The catalog carries no scope, so any signed-in user reads it whole —
  // this stays JwtAuthGuard-only, never AdminGuard, since `/preferences`
  // (not an admin screen) is the caller. Only createTorrentGroup and
  // deleteTorrentGroup are administrator-only.
  @UseGuards(JwtAuthGuard)
  @Query(() => [TorrentGroup])
  async torrentGroups(@CurrentUser() principal: AuthPrincipal): Promise<TorrentGroup[]> {
    if (principal.type !== 'user') {
      throw i18nError.unauthorized(ERROR_KEYS.AUTH_UNAUTHENTICATED);
    }
    return this.preferencesService.findCatalog();
  }

  @UseGuards(JwtAuthGuard)
  @Mutation(() => UserPreferences)
  async setAllowCinemaReleases(
    @CurrentUser() principal: AuthPrincipal,
    @Args('allowed') allowed: boolean,
  ): Promise<UserPreferences> {
    if (principal.type !== 'user') {
      throw i18nError.unauthorized(ERROR_KEYS.AUTH_UNAUTHENTICATED);
    }
    return this.preferencesService.setAllowCinemaReleases(principal.id, allowed);
  }

  @UseGuards(JwtAuthGuard)
  @Mutation(() => UserPreferences)
  async setAudioMandatory(
    @CurrentUser() principal: AuthPrincipal,
    @Args('mandatory') mandatory: boolean,
  ): Promise<UserPreferences> {
    if (principal.type !== 'user') {
      throw i18nError.unauthorized(ERROR_KEYS.AUTH_UNAUTHENTICATED);
    }
    return this.preferencesService.setAudioMandatory(principal.id, mandatory);
  }

  @UseGuards(JwtAuthGuard)
  @Mutation(() => [Language])
  async setPreferredTrackLanguages(
    @CurrentUser() principal: AuthPrincipal,
    @Args('kind', { type: () => LanguageTrackKind }) kind: LanguageTrackKind,
    @Args('tags', { type: () => [String] }) tags: string[],
  ): Promise<Language[]> {
    if (principal.type !== 'user') {
      throw i18nError.unauthorized(ERROR_KEYS.AUTH_UNAUTHENTICATED);
    }
    return this.languagesService.setPreferredTrackLanguagesFor(
      principal.id,
      kind as unknown as PrismaLanguageTrackKind,
      tags,
    );
  }

  @UseGuards(AdminGuard)
  @Mutation(() => TorrentGroup)
  async createTorrentGroup(@Args('name') name: string): Promise<TorrentGroup> {
    return this.preferencesService.createTorrentGroup(name);
  }

  @UseGuards(AdminGuard)
  @Mutation(() => Boolean)
  async deleteTorrentGroup(@Args('id', { type: () => Int }) id: number): Promise<boolean> {
    return this.preferencesService.deleteTorrentGroup(id);
  }

  @UseGuards(JwtAuthGuard)
  @Mutation(() => [TorrentGroup])
  async setPreferredTorrentGroups(
    @CurrentUser() principal: AuthPrincipal,
    @Args('scope', { type: () => TorrentGroupScope }) scope: TorrentGroupScope,
    @Args('ids', { type: () => [Int] }) ids: number[],
  ): Promise<TorrentGroup[]> {
    if (principal.type !== 'user') {
      throw i18nError.unauthorized(ERROR_KEYS.AUTH_UNAUTHENTICATED);
    }
    return this.preferencesService.setPreferredTorrentGroupsFor(principal.id, scope, ids);
  }
}
