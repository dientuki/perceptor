import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from '../strategies/jwt.strategy';
import { SessionService } from '../session.service';
import { AUTH_COOKIE_NAME } from '../auth.constants';

// This strategy carries two guarantees that are each invisible until they
// are wrong in production: which carrier wins when a request somehow
// presents both a bearer header and a cookie (REQ-3), and that a revoked
// user session is rejected even though the JWT signature and expiry are
// both still valid (AC-5). A service principal skipping the session check
// is equally load-bearing the other way — service credentials never expire
// and never get a `jti`, so subjecting them to the same lookup would make
// every worker/qBittorrent call fail with no session ever created for it.
describe('JwtStrategy', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret';
  });

  const buildStrategy = (sessionService: Partial<SessionService>) =>
    new JwtStrategy(sessionService as SessionService);

  describe('token extraction', () => {
    it('reads the token from the Authorization bearer header', () => {
      const strategy = buildStrategy({});
      const extractor = (strategy as unknown as { _jwtFromRequest: (req: unknown) => string | null })
        ._jwtFromRequest;
      const req = { headers: { authorization: 'Bearer from-header' }, cookies: {} };

      expect(extractor(req)).toBe('from-header');
    });

    it('falls back to the auth cookie when there is no bearer header', () => {
      const strategy = buildStrategy({});
      const extractor = (strategy as unknown as { _jwtFromRequest: (req: unknown) => string | null })
        ._jwtFromRequest;
      const req = { headers: {}, cookies: { [AUTH_COOKIE_NAME]: 'from-cookie' } };

      expect(extractor(req)).toBe('from-cookie');
    });

    it('prefers an explicit bearer header over an ambient cookie', () => {
      const strategy = buildStrategy({});
      const extractor = (strategy as unknown as { _jwtFromRequest: (req: unknown) => string | null })
        ._jwtFromRequest;
      const req = {
        headers: { authorization: 'Bearer from-header' },
        cookies: { [AUTH_COOKIE_NAME]: 'from-cookie' },
      };

      expect(extractor(req)).toBe('from-header');
    });
  });

  describe('validate', () => {
    it('accepts a service principal without consulting the session store', async () => {
      const exists = jest.fn();
      const strategy = buildStrategy({ exists });

      const principal = await strategy.validate({ sub: 'service:perceptor', typ: 'service' });

      expect(principal).toEqual({ type: 'service', name: 'service:perceptor' });
      expect(exists).not.toHaveBeenCalled();
    });

    it('accepts a user principal whose session is still live', async () => {
      const exists = jest.fn().mockResolvedValue(true);
      const strategy = buildStrategy({ exists });

      const principal = await strategy.validate({ sub: '1', username: 'juan', jti: 'abc' });

      expect(principal).toEqual({ type: 'user', id: '1', username: 'juan' });
      expect(exists).toHaveBeenCalledWith('abc');
    });

    it('rejects a user principal whose session was revoked', async () => {
      const exists = jest.fn().mockResolvedValue(false);
      const strategy = buildStrategy({ exists });

      await expect(
        strategy.validate({ sub: '1', username: 'juan', jti: 'revoked' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
