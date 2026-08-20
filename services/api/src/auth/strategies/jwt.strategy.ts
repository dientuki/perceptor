import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import { AUTH_COOKIE_NAME, getJwtSecret } from '../auth.constants';
import { toPrincipal, JwtPayload } from '../auth.types';
import { SessionService } from '../session.service';
import { i18nError } from '@/i18n/i18n-error';
import { ERROR_KEYS } from '@/i18n/error-keys';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly sessionService: SessionService) {
    super({
      // Bearer checked first: an explicit Authorization header beats an
      // ambient cookie (REQ-3) — the worker and the qBittorrent hook only
      // ever send the header, the browser only ever sends the cookie, and a
      // request carrying both should trust the one that was set on purpose.
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (req: Request) => req?.cookies?.[AUTH_COOKIE_NAME] ?? null,
      ]),
      ignoreExpiration: false,
      secretOrKey: getJwtSecret(),
    });
  }

  async validate(payload: JwtPayload) {
    const principal = toPrincipal(payload);

    if (principal.type === 'user') {
      // Service principals carry no `jti` and never expire (see
      // scripts/mint-service-token.ts) — only user sessions are revocable,
      // so only user principals are checked against the Redis registry. A
      // user-typed payload with no `jti` is a malformed/foreign token, not a
      // session that ever existed — that's "no credential at all".
      if (!('jti' in payload)) {
        throw i18nError.unauthorized(ERROR_KEYS.AUTH_UNAUTHENTICATED);
      }
      // The JWT itself is still valid, but the Redis session record behind
      // it is gone (logout, `revokeAllForUser` on disable, or TTL) — that is
      // a revoked/expired session, not a missing credential.
      const isLive = await this.sessionService.exists(payload.jti);
      if (!isLive) {
        throw i18nError.unauthorized(ERROR_KEYS.AUTH_SESSION_EXPIRED);
      }
    }

    return principal;
  }
}
