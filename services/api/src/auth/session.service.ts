import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RedisService } from '../redis/redis.service';
import { REMEMBER_ME_TTL, ttlToSeconds } from './auth.constants';

const SESSION_KEY_PREFIX = 'session:';
const USER_SESSIONS_KEY_PREFIX = 'user-sessions:';

/**
 * The server-side half of REQ-10/AC-5 (`002-auth-login`): a Redis-backed
 * registry of live sessions, keyed by a `jti` minted at login. `JwtStrategy`
 * checks `exists()` for every user principal, so a token that is otherwise
 * perfectly valid (correct signature, not expired) still gets rejected once
 * its session record is gone — which is the only way a stateless JWT can be
 * made to stop working before its own expiry.
 *
 * It is also the mechanism behind `004-user-disable`'s REQ-3: a per-user
 * Redis SET (`user-sessions:<userId>`) tracks every `jti` that user
 * currently holds, so `revokeAllForUser` can kill every session that user
 * has open the moment an administrator disables the account, rather than
 * waiting for each session to hit its own expiry.
 */
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

  /**
   * Kills every session a user currently holds, across however many
   * browsers or devices they're signed in on (`004-user-disable` REQ-3). An
   * empty or missing set is a no-op, not an error — a user with no live
   * sessions is not a failure case.
   */
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
