import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RedisService } from '../redis/redis.service';
import { REMEMBER_ME_TTL, ttlToSeconds } from './auth.constants';

const SESSION_KEY_PREFIX = 'session:';
const USER_SESSIONS_KEY_PREFIX = 'user-sessions:';

// Spec 002, REQ-10 AC-5; Spec 004, REQ-3
@Injectable()
export class SessionService {
  constructor(private readonly redis: RedisService) {}

  async create(userId: string, ttlSeconds: number): Promise<string> {
    const jti = randomUUID();
    await this.redis.set(`${SESSION_KEY_PREFIX}${jti}`, userId, 'EX', ttlSeconds);

    const userSessionsKey = `${USER_SESSIONS_KEY_PREFIX}${userId}`;
    await this.redis.sadd(userSessionsKey, jti);
    // The set must outlive every session it tracks, including one created
    // earlier in the set's life with the longer "remember me" TTL —
    // refreshing to REMEMBER_ME_TTL on every create keeps an active
    // account's set from expiring out from under a still-live session.
    await this.redis.expire(userSessionsKey, ttlToSeconds(REMEMBER_ME_TTL));

    return jti;
  }

  async exists(jti: string): Promise<boolean> {
    const result = await this.redis.exists(`${SESSION_KEY_PREFIX}${jti}`);
    return result === 1;
  }

  async revoke(jti: string): Promise<void> {
    // Read the owning user before deleting the session key: deleting first
    // would make this lookup return null, silently leaking the `jti` as a
    // member of that user's set that nothing will ever clean up.
    const userId = await this.redis.get(`${SESSION_KEY_PREFIX}${jti}`);
    await this.redis.del(`${SESSION_KEY_PREFIX}${jti}`);
    if (userId) {
      await this.redis.srem(`${USER_SESSIONS_KEY_PREFIX}${userId}`, jti);
    }
  }

  // Spec 004, REQ-3
  async revokeAllForUser(userId: string): Promise<void> {
    const userSessionsKey = `${USER_SESSIONS_KEY_PREFIX}${userId}`;
    const jtis = await this.redis.smembers(userSessionsKey);
    if (jtis.length === 0) {
      return;
    }
    await Promise.all(jtis.map((jti) => this.redis.del(`${SESSION_KEY_PREFIX}${jti}`)));
    await this.redis.del(userSessionsKey);
  }
}
