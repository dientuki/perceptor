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
});
