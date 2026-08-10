// Single source for every auth-related constant so nothing downstream ever
// hardcodes a cookie name, a TTL or a fallback secret again.

export const AUTH_COOKIE_NAME = 'auth_token';
export const SESSION_TTL = '12h';
export const REMEMBER_ME_TTL = '30d';
export const UPLOAD_TICKET_TTL_SECONDS = 60;

/**
 * Converts one of this module's human-readable TTL strings ('12h', '30d',
 * ...) into seconds. Needed because a Redis `EX` argument and
 * `SessionService.create`'s `ttlSeconds` parameter both want a number, while
 * the constants above stay readable at the call site.
 */
export function ttlToSeconds(ttl: string): number {
  const match = /^(\d+)([smhd])$/.exec(ttl);
  if (!match) {
    throw new Error(`Unsupported TTL format: "${ttl}"`);
  }
  const [, amount, unit] = match;
  const secondsPerUnit: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return Number(amount) * secondsPerUnit[unit];
}

/**
 * The JWT signing secret. No fallback literal here, ever (REQ-6): a default
 * would mean every deployment that forgets to set JWT_SECRET silently signs
 * and verifies tokens with a secret sitting in this repository's history.
 */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      'JWT_SECRET is not set. The api refuses to start without an explicit signing secret ' +
        '— set JWT_SECRET in the environment, there is no default.',
    );
  }
  return secret;
}

/**
 * Called as the first statement of bootstrap() so a missing secret fails
 * loudly at boot (AC-8), not silently on the first login attempt.
 */
export function assertAuthEnv(): void {
  getJwtSecret();
}
