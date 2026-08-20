import type { ExecutionContext } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthResolver } from '../auth.resolver';
import { AuthService } from '../auth.service';
import { AdminGuard } from '../guards/admin.guard';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { JwtStrategy } from '../strategies/jwt.strategy';
import { ERROR_KEYS } from '@/i18n/error-keys';
import type { I18nExceptionResponse } from '@/i18n/i18n-error';

// REQ-14 depends entirely on `web`'s `auth-session.ts` recognising exactly
// two keys — `error.auth.unauthenticated` and `error.auth.session_expired`
// — off `extensions.i18n.key`. No compiler crosses the GraphQL seam, so a
// throw site here that silently reverts to a raw string (or the wrong key)
// is invisible in this service: the request still 401s, the type still
// checks, and only a live browser mid-session-expiry ever notices, with
// nothing logged anywhere (plan.md § Risks, "Auth detection breaks"). This
// suite exercises the real guard/service/strategy code paths — not a
// re-assertion of a constant against itself — for every throw site the spec's
// `auth` error table lists, and specifically pins the two REQ-14 keys onto
// exactly the sites that mean "no credential" vs. "credential no longer
// valid".
describe('auth throw sites carry the frozen i18n keys', () => {
  function i18nKeyOf(fn: () => unknown): string {
    try {
      fn();
    } catch (err) {
      const response = (err as { getResponse: () => I18nExceptionResponse }).getResponse();
      return response.i18n.key;
    }
    throw new Error('expected fn to throw');
  }

  async function i18nKeyOfAsync(fn: () => Promise<unknown>): Promise<string> {
    try {
      await fn();
    } catch (err) {
      const response = (err as { getResponse: () => I18nExceptionResponse }).getResponse();
      return response.i18n.key;
    }
    throw new Error('expected fn to reject');
  }

  function fakeGqlContext(user: unknown): ExecutionContext {
    return {
      getArgs: () => [{}, {}, { req: { user } }, {}],
      getClass: () => class Handler {},
      getHandler: () => function handler() {},
      getType: () => 'graphql',
      switchToHttp: () => ({}) as never,
      switchToRpc: () => ({}) as never,
      switchToWs: () => ({}) as never,
    } as unknown as ExecutionContext;
  }

  describe('AuthResolver.me — no credential at all reaching a user-only query', () => {
    it('emits error.auth.unauthenticated for a service principal', async () => {
      const resolver = new AuthResolver(
        {} as never,
        {} as never,
        {} as never,
      );

      const key = await i18nKeyOfAsync(() => resolver.me({ type: 'service', name: 'svc' }));

      expect(key).toBe(ERROR_KEYS.AUTH_UNAUTHENTICATED);
    });
  });

  describe('AuthService', () => {
    it('login() emits error.auth.invalid_credentials for an unknown username', async () => {
      const prisma = { user: { findUnique: jest.fn().mockResolvedValue(null) } };
      const service = new AuthService(prisma as never, {} as never, {} as never);

      const key = await i18nKeyOfAsync(() => service.login('nobody', 'whatever', false));

      expect(key).toBe(ERROR_KEYS.AUTH_INVALID_CREDENTIALS);
    });

    it('login() emits error.auth.account_disabled for a disabled user with the right password', async () => {
      const password = await bcrypt.hash('correct-horse', 4);
      const prisma = {
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: '1',
            username: 'juan',
            password,
            isEnabled: false,
          }),
        },
      };
      const service = new AuthService(prisma as never, {} as never, {} as never);

      const key = await i18nKeyOfAsync(() => service.login('juan', 'correct-horse', false));

      expect(key).toBe(ERROR_KEYS.AUTH_ACCOUNT_DISABLED);
    });

    // The JWT and its Redis session are still both live — this is a session
    // that has become invalid, not a request with no credential.
    it('getProfile() emits error.auth.session_expired for a user deleted after the token was issued', async () => {
      const prisma = { user: { findUnique: jest.fn().mockResolvedValue(null) } };
      const service = new AuthService(prisma as never, {} as never, {} as never);

      const key = await i18nKeyOfAsync(() => service.getProfile('deleted-user-id'));

      expect(key).toBe(ERROR_KEYS.AUTH_SESSION_EXPIRED);
    });
  });

  describe('AdminGuard — distinct from the two REQ-14 keys by design', () => {
    it('emits error.auth.admin_required for a non-user principal', async () => {
      const guard = new AdminGuard({} as never);
      const context = fakeGqlContext({ type: 'service', name: 'svc' });

      const key = await i18nKeyOfAsync(() => guard.canActivate(context));

      expect(key).toBe(ERROR_KEYS.AUTH_ADMIN_REQUIRED);
    });

    it('emits error.auth.admin_required for a non-admin user', async () => {
      const prisma = { user: { findUnique: jest.fn().mockResolvedValue({ isAdmin: false }) } };
      const guard = new AdminGuard(prisma as never);
      const context = fakeGqlContext({ type: 'user', id: '1', username: 'juan', jti: 'x' });

      const key = await i18nKeyOfAsync(() => guard.canActivate(context));

      expect(key).toBe(ERROR_KEYS.AUTH_ADMIN_REQUIRED);
    });
  });

  describe('JwtAuthGuard', () => {
    it('handleRequest() emits error.auth.session_expired for an expired token', () => {
      const guard = new JwtAuthGuard({} as never);

      const key = i18nKeyOf(() => guard.handleRequest(undefined, null, { name: 'TokenExpiredError' }));

      expect(key).toBe(ERROR_KEYS.AUTH_SESSION_EXPIRED);
    });

    it('handleRequest() emits error.auth.session_expired for a tampered token', () => {
      const guard = new JwtAuthGuard({} as never);

      const key = i18nKeyOf(() => guard.handleRequest(undefined, null, { name: 'JsonWebTokenError' }));

      expect(key).toBe(ERROR_KEYS.AUTH_SESSION_EXPIRED);
    });

    it('handleRequest() emits error.auth.unauthenticated when there is simply no user', () => {
      const guard = new JwtAuthGuard({} as never);

      const key = i18nKeyOf(() => guard.handleRequest(undefined, null, undefined));

      expect(key).toBe(ERROR_KEYS.AUTH_UNAUTHENTICATED);
    });

    it('canActivate() emits error.auth.unauthenticated for a service principal on a user-only operation', async () => {
      const guard = new JwtAuthGuard({
        getAllAndOverride: jest.fn().mockReturnValue(undefined),
      } as never);
      // super.canActivate() is Passport's own guard, which needs a running
      // strategy — bypassed here because the behaviour under test is what
      // JwtAuthGuard.canActivate() does *after* authentication succeeds, not
      // Passport's own authentication.
      const passportProto = Object.getPrototypeOf(JwtAuthGuard.prototype) as {
        canActivate: (context: ExecutionContext) => Promise<boolean>;
      };
      jest.spyOn(passportProto, 'canActivate').mockResolvedValue(true);
      const context = fakeGqlContext({ type: 'service', name: 'svc' });

      const key = await i18nKeyOfAsync(() => guard.canActivate(context));

      expect(key).toBe(ERROR_KEYS.AUTH_UNAUTHENTICATED);

      jest.restoreAllMocks();
    });
  });

  describe('JwtStrategy.validate', () => {
    it('emits error.auth.unauthenticated for a user-typed payload with no jti', async () => {
      const strategy = new JwtStrategy({ exists: jest.fn() } as never);

      const key = await i18nKeyOfAsync(() =>
        strategy.validate({ sub: '1', username: 'juan' } as never),
      );

      expect(key).toBe(ERROR_KEYS.AUTH_UNAUTHENTICATED);
    });

    it('emits error.auth.session_expired when the Redis session behind a valid JWT is gone', async () => {
      const strategy = new JwtStrategy({ exists: jest.fn().mockResolvedValue(false) } as never);

      const key = await i18nKeyOfAsync(() =>
        strategy.validate({ sub: '1', username: 'juan', jti: 'revoked' }),
      );

      expect(key).toBe(ERROR_KEYS.AUTH_SESSION_EXPIRED);
    });
  });

  // The regression this whole suite exists to catch: every site that used to
  // throw the plain-string 'No autenticado' or 'Tu sesión expiró, iniciá
  // sesión de nuevo' must resolve to exactly one of these two constants. If a
  // future edit renamed or repointed either constant, every case above would
  // fail, not just an assertion that a constant equals itself.
  it('the two REQ-14 keys are distinct strings', () => {
    expect(ERROR_KEYS.AUTH_UNAUTHENTICATED).not.toBe(ERROR_KEYS.AUTH_SESSION_EXPIRED);
    expect(ERROR_KEYS.AUTH_UNAUTHENTICATED).toBe('error.auth.unauthenticated');
    expect(ERROR_KEYS.AUTH_SESSION_EXPIRED).toBe('error.auth.session_expired');
  });
});
