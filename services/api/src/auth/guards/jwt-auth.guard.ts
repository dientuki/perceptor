import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { GqlContextType, GqlExecutionContext } from '@nestjs/graphql';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ALLOW_SERVICE_KEY } from '../decorators/allow-service.decorator';
import type { AuthPrincipal } from '../auth.types';
import { i18nError } from '@/i18n/i18n-error';
import { ERROR_KEYS } from '@/i18n/error-keys';

// NOT registered as APP_GUARD yet (that's a later, separate task) — this
// class is authored ahead of time so the flip, when it happens, is the two
// lines the plan promises and nothing else.
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Checked before super.canActivate() runs Passport, on purpose: if this
    // were reversed, a corrupted or expired cookie sitting in a
    // signed-out-but-still-has-a-stale-cookie browser would make `login`
    // itself permanently unreachable.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    // This guard must never reach REST routes (i.e. /uploads) — tus's own
    // PATCH chunks would get 401'd mid-upload otherwise. The upload path is
    // authenticated separately, at the tus layer, by the ticket mechanism.
    if (context.getType<GqlContextType>() !== 'graphql') {
      return true;
    }

    const authenticated = (await super.canActivate(context)) as boolean;
    if (!authenticated) {
      return false;
    }

    const principal = this.getRequest(context).user as AuthPrincipal;
    const allowsService = this.reflector.getAllAndOverride<boolean>(ALLOW_SERVICE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (principal.type === 'service' && !allowsService) {
      // Same key as "no credential at all" — a service principal hitting a
      // user-only operation does not get a distinct user-facing key here.
      // `018-ui-i18n`'s auth error table defines five keys; `error.auth.
      // account_disabled` belongs to the login path, not this rejection
      // (see plan.md § Contract Freeze).
      throw i18nError.unauthorized(ERROR_KEYS.AUTH_UNAUTHENTICATED);
    }

    return true;
  }

  getRequest(context: ExecutionContext) {
    if (context.getType<GqlContextType>() === 'graphql') {
      return GqlExecutionContext.create(context).getContext().req;
    }
    return context.switchToHttp().getRequest();
  }

  handleRequest<TUser = AuthPrincipal>(err: unknown, user: TUser, info: { name?: string } | undefined): TUser {
    if (user) {
      return user;
    }
    if (info?.name === 'TokenExpiredError' || info?.name === 'JsonWebTokenError') {
      throw i18nError.unauthorized(ERROR_KEYS.AUTH_SESSION_EXPIRED);
    }
    throw i18nError.unauthorized(ERROR_KEYS.AUTH_UNAUTHENTICATED);
  }
}
