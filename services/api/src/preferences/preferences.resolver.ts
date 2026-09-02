import { UseGuards } from '@nestjs/common';
import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';
import { LanguageTrackKind as PrismaLanguageTrackKind } from '@prisma/client';

import { CurrentUser } from '@/auth/decorators/current-user.decorator';
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

// Every operation is rooted at @CurrentUser() and rejects a non-user
// principal the same way AuthResolver's setUiLocale/me do — no operation
// here takes a user id and none carries @AllowService() (REQ-9).
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

  @UseGuards(JwtAuthGuard)
  @Query(() => [TorrentGroup])
  async torrentGroups(
    @CurrentUser() principal: AuthPrincipal,
    @Args('scope', { type: () => TorrentGroupScope, nullable: true }) scope?: TorrentGroupScope,
  ): Promise<TorrentGroup[]> {
    if (principal.type !== 'user') {
      throw i18nError.unauthorized(ERROR_KEYS.AUTH_UNAUTHENTICATED);
    }
    return this.preferencesService.findCatalog(scope ?? undefined);
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
