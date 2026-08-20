import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthPrincipal } from '../auth.types';
import { i18nError } from '@/i18n/i18n-error';
import { ERROR_KEYS } from '@/i18n/error-keys';

// Runs after JwtAuthGuard (APP_GUARD), which has already attached a
// principal to the request — this guard only decides *authorization*, not
// authentication. `isAdmin` is checked fresh from the database on every
// call rather than trusted from the JWT: there is no `isAdmin` claim in the
// token, deliberately, so a demoted admin's still-valid session stops
// working on the very next request instead of waiting out its TTL.
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const principal = GqlExecutionContext.create(context).getContext().req.user as AuthPrincipal;

    if (principal.type !== 'user') {
      throw i18nError.forbidden(ERROR_KEYS.AUTH_ADMIN_REQUIRED);
    }

    const user = await this.prisma.user.findUnique({
      where: { id: principal.id },
      select: { isAdmin: true },
    });

    if (!user?.isAdmin) {
      throw i18nError.forbidden(ERROR_KEYS.AUTH_ADMIN_REQUIRED);
    }

    return true;
  }
}
