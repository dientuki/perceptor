import { UseGuards } from '@nestjs/common';
import { Resolver, Mutation, Query, Args, ResolveField, Parent } from '@nestjs/graphql';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { LoginResponse } from './dto/login-response';
import { LoginInput } from './dto/login.input';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { Language } from '@/languages/entities/language.entity';
import { LanguagesService } from '@/languages/languages.service';
import { SUPPORTED_LOCALES } from '@/i18n/locales';
import { i18nError } from '@/i18n/i18n-error';
import { ERROR_KEYS } from '@/i18n/error-keys';
import type { AuthPrincipal } from './auth.types';

// @Resolver(() => User) rather than the parameterless form used before this
// feature: a @ResolveField() needs a type to attach to. UsersResolver also
// targets User (for the admin CRUD queries) — Nest merges fields from both
// resolvers onto the one GraphQL type, so this does not duplicate anything.
@Resolver(() => User)
export class AuthResolver {
  constructor(
    private authService: AuthService,
    private languagesService: LanguagesService,
    private usersService: UsersService,
  ) {}

  // REQ-18: the picker this feature does not build reads this rather than
  // hardcoding a list. Derived from SUPPORTED_LOCALES, never a literal array
  // here — that's the whole point of REQ-17.
  @Query(() => [String])
  supportedLocales(): readonly string[] {
    return SUPPORTED_LOCALES;
  }

  @UseGuards(JwtAuthGuard)
  @Mutation(() => User)
  async setUiLocale(
    @CurrentUser() principal: AuthPrincipal,
    @Args('locale') locale: string,
  ): Promise<User> {
    if (principal.type !== 'user') {
      throw i18nError.unauthorized(ERROR_KEYS.AUTH_UNAUTHENTICATED);
    }
    return await this.usersService.setUiLocale(principal.id, locale);
  }

  // The only public operation in the schema (REQ-4) — every other resolver
  // requires a credential once JwtAuthGuard is registered as APP_GUARD.
  @Public()
  @Mutation(() => LoginResponse, { description: 'Inicia sesión y retorna un JWT' })
  async login(
    @Args('loginInput') loginInput: LoginInput,
  ): Promise<LoginResponse> {
    return await this.authService.login(
      loginInput.username,
      loginInput.password,
      loginInput.rememberMe,
    );
  }

  // The API can never reach a cookie scoped to a different origin — `web`
  // owns clearing it. Logout here only ever needs to revoke the caller's own
  // Redis session record (REQ-10, AC-5).
  @UseGuards(JwtAuthGuard)
  @Mutation(() => Boolean)
  async logout(@CurrentUser() principal: AuthPrincipal): Promise<boolean> {
    if (principal.type === 'user') {
      await this.authService.logout(principal.jti);
    }
    return true;
  }

  // Deliberately no @AllowService() — a service principal must be rejected
  // here, it has no user profile to resolve.
  @UseGuards(JwtAuthGuard)
  @Query(() => User)
  async me(@CurrentUser() principal: AuthPrincipal): Promise<User> {
    // Structurally unreachable today — the guard's absent @AllowService()
    // already keeps a service principal out — but TypeScript still needs the
    // narrowing to access `.id`, and this is the same key the guard itself
    // would throw for the same reason: reusing it here doesn't add a new
    // user-facing key on this boundary. `018-ui-i18n`'s auth error table
    // defines five keys; `error.auth.account_disabled` is the one that
    // belongs to `login`, not this query.
    if (principal.type !== 'user') {
      throw i18nError.unauthorized(ERROR_KEYS.AUTH_UNAUTHENTICATED);
    }
    return await this.authService.getProfile(principal.id);
  }

  // Field resolvers attach per-*type*, not per-query: because UsersResolver's
  // admin `users`/`user(id)` queries also return `User`, this field is
  // selectable there too, not just on `me`. Guard against reading someone
  // else's preferences through that path — an admin has no reason to see
  // another user's saved languages (see the feature spec's GraphQL Contract
  // Delta) — by returning `[]` for any parent that isn't the caller, rather
  // than throwing: nobody should be selecting this field outside `me` in the
  // first place, so a quiet empty array is a better UX than a GraphQL error.
  @ResolveField(() => [Language])
  async preferredLanguages(
    @Parent() user: User,
    @CurrentUser() principal: AuthPrincipal,
  ): Promise<Language[]> {
    const callerId = principal.type === 'user' ? principal.id : '';
    if (user.id !== callerId) {
      return [];
    }
    return this.languagesService.findPreferredLanguagesFor(user.id);
  }
}