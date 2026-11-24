// Spec 121, REQ-9
export function boundedRetryAfterMs(
  res: Response,
  maxMs: number,
  defaultMs: number,
): number {
  const raw =
    res.headers?.get('retry-after') ?? res.headers?.get('ratelimit-reset');
  const seconds = raw === null || raw === undefined ? NaN : Number(raw);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : defaultMs;
  return Math.max(0, Math.min(ms, maxMs));
}
