import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RedisService } from '../redis/redis.service';

const SESSION_KEY_PREFIX = 'session:';

/**
 * The server-side half of REQ-10/AC-5: a Redis-backed registry of live
 * sessions, keyed by a `jti` minted at login. `JwtStrategy` checks
 * `exists()` for every user principal, so a token that is otherwise
 * perfectly valid (correct signature, not expired) still gets rejected once
 * its session record is gone — which is the only way a stateless JWT can be
 * made to stop working before its own expiry.
 */
@Injectable()
export class SessionService {
  constructor(private readonly redis: RedisService) {}

  async create(userId: string, ttlSeconds: number): Promise<string> {
    const jti = randomUUID();
    await this.redis.set(`${SESSION_KEY_PREFIX}${jti}`, userId, 'EX', ttlSeconds);
    return jti;
  }

  async exists(jti: string): Promise<boolean> {
    const result = await this.redis.exists(`${SESSION_KEY_PREFIX}${jti}`);
    return result === 1;
  }

  async revoke(jti: string): Promise<void> {
    await this.redis.del(`${SESSION_KEY_PREFIX}${jti}`);
  }
}
