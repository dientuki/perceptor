import { UseGuards } from '@nestjs/common';
import { Resolver, Mutation, Args } from '@nestjs/graphql';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthPrincipal } from '../auth/auth.types';
import { UpdateProfileInput } from './dto/update-profile.input';
import { User } from './entities/user.entity';
import { UsersService } from './users.service';
import { i18nError } from '@/i18n/i18n-error';
import { ERROR_KEYS } from '@/i18n/error-keys';

// Deliberately its own resolver, not a method on `UsersResolver` — that
// class carries `@UseGuards(AdminGuard)` at the class level, and adding a
// self-service mutation there would mean weakening or per-method overriding
// that guard (`020-profile-edit` plan.md § Approach). `@UseGuards(JwtAuthGuard)`
// here is redundant with the global `APP_GUARD` and deliberate, mirroring
// `AuthResolver.me` — the local idiom for a self-scoped operation.
@Resolver(() => User)
export class ProfileResolver {
  constructor(private readonly usersService: UsersService) {}

  @UseGuards(JwtAuthGuard)
  @Mutation(() => User)
  async updateProfile(
    @Args('updateProfileInput') updateProfileInput: UpdateProfileInput,
    @CurrentUser() principal: AuthPrincipal,
  ): Promise<User> {
    // No `id` argument, ever — the target is always the caller. A service
    // principal (e.g. `SERVICE_TOKEN`) has no profile and must be refused,
    // the same way `me` refuses one.
    if (principal.type !== 'user') {
      throw i18nError.unauthorized(ERROR_KEYS.AUTH_UNAUTHENTICATED);
    }
    return await this.usersService.updateProfile(principal.id, updateProfileInput);
  }
}
