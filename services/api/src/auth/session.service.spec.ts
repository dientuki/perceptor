import { randomUUID } from 'node:crypto';
import { RedisService } from '../redis/redis.service';
import { SessionService } from './session.service';

// SessionService is the entire mechanism behind AC-5: a logout (or a session
// that outlives its intended lifetime) has to make a still-correctly-signed
// JWT stop authenticating. If `revoke` didn't actually delete the key, or
// `create` never attached a TTL, the UI would show "logged out" while a
// `curl` replaying the old cookie kept working — silently, because nothing
// in the JWT itself would be wrong. Runs against the real Redis this stack
// already depends on rather than a mock, because the property under test is
// "did the key actually disappear from the store", which a mock can only
// assert by construction.
describe('SessionService', () => {
  let redis: RedisService;
  let service: SessionService;

  beforeAll(() => {
    redis = new RedisService();
    service = new SessionService(redis);
  });

  afterAll(async () => {
    await redis.quit();
  });

  it('a freshly created session reports as existing', async () => {
    const jti = await service.create(randomUUID(), 60);

    await expect(service.exists(jti)).resolves.toBe(true);
  });

  it('a revoked session no longer exists', async () => {
    const jti = await service.create(randomUUID(), 60);

    await service.revoke(jti);

    await expect(service.exists(jti)).resolves.toBe(false);
  });

  it('an unknown jti was never a session', async () => {
    await expect(service.exists(randomUUID())).resolves.toBe(false);
  });

  it('stores the session with the given TTL rather than living forever', async () => {
    const jti = await service.create(randomUUID(), 60);

    const ttl = await redis.ttl(`session:${jti}`);

    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
  });

  // 004-user-disable REQ-3: disabling a user must kill every session they
  // currently hold, not just the next login. `revokeAllForUser` is the whole
  // mechanism — if it revoked only some of a user's sessions (or none), a
  // disabled user would keep browsing in whichever browser wasn't caught,
  // with nothing anywhere reporting an error.
  describe('revokeAllForUser', () => {
    it('kills every session held by that user, all at once', async () => {
      const userId = randomUUID();
      const jtiA = await service.create(userId, 60);
      const jtiB = await service.create(userId, 60);
      const jtiC = await service.create(userId, 60);

      await service.revokeAllForUser(userId);

      await expect(service.exists(jtiA)).resolves.toBe(false);
      await expect(service.exists(jtiB)).resolves.toBe(false);
      await expect(service.exists(jtiC)).resolves.toBe(false);
    });

    it('leaves another user entirely untouched', async () => {
      const disabledUserId = randomUUID();
      const otherUserId = randomUUID();
      const disabledJti = await service.create(disabledUserId, 60);
      const otherJti = await service.create(otherUserId, 60);

      await service.revokeAllForUser(disabledUserId);

      await expect(service.exists(disabledJti)).resolves.toBe(false);
      await expect(service.exists(otherJti)).resolves.toBe(true);
    });

    it('is a no-op for a user with no live sessions', async () => {
      // Must not throw, and must not touch anyone else's sessions.
      await expect(service.revokeAllForUser(randomUUID())).resolves.toBeUndefined();
    });

    it('deletes the per-user set itself, not just its members', async () => {
      const userId = randomUUID();
      await service.create(userId, 60);
      await service.create(userId, 60);

      await service.revokeAllForUser(userId);

      const remaining = await redis.smembers(`user-sessions:${userId}`);
      expect(remaining).toEqual([]);
    });
  });

  // `revoke` (a single-session logout) also has to keep the reverse mapping
  // honest, or an old jti lingers in the set forever as a member whose
  // `session:<jti>` key is long gone — inert today, but exactly the kind of
  // drift `revokeAllForUser` depends on not existing.
  it('revoke removes the jti from its user\'s session set, not just the session key', async () => {
    const userId = randomUUID();
    const jti = await service.create(userId, 60);

    await service.revoke(jti);

    const remaining = await redis.smembers(`user-sessions:${userId}`);
    expect(remaining).not.toContain(jti);
  });
});
