import { UnauthorizedException, UseGuards } from '@nestjs/common';
import { Resolver, Mutation, Query, Args } from '@nestjs/graphql';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { LoginResponse } from './dto/login-response';
import { LoginInput } from './dto/login.input';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { User } from '../users/entities/user.entity';
import type { AuthPrincipal } from './auth.types';

@Resolver()
export class AuthResolver {
  constructor(private authService: AuthService) {}

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
    // narrowing to access `.id`, and this is the same message the guard
    // itself would throw for the same reason (no sixth user-facing string).
    if (principal.type !== 'user') {
      throw new UnauthorizedException('No autenticado');
    }
    return await this.authService.getProfile(principal.id);
  }
}