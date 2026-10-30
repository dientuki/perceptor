import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';

// Spec 111, NFR-2
export const VERDICT_TTL_SECONDS = 2_592_000;

// Spec 111, NFR-3
export const VERDICT_CALL_TIMEOUT_MS = 5_000;

// Spec 111, NFR-5
export const VERDICT_KEY_PREFIX = 'perceptor:encode:';

export const VERDICT_KINDS = [
  'grain',
  'dubtrim',
  'streamtrim',
  'subs',
  'assembly',
  // Spec 110, REQ-8
  'audio-variant',
] as const;

export type VerdictKind = (typeof VERDICT_KINDS)[number];

export type VerdictIdentity = Record<string, unknown> | null;

export interface VerdictRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ex: 'EX', seconds: number): Promise<unknown>;
}

export interface FileIdentity {
  path: string;
  size: number;
  mtimeMs: number;
}

let installed: VerdictRedis | null = null;

export function installVerdictStore(redis: VerdictRedis | null): void {
  installed = redis;
}

export async function fileIdentity(path: string): Promise<FileIdentity | null> {
  try {
    const info = await stat(path);
    return { path, size: info.size, mtimeMs: info.mtimeMs };
  } catch {
    return null;
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = canonicalize(source[key]);
    }
    return sorted;
  }
  return value;
}

export function verdictKey(kind: VerdictKind, identity: Record<string, unknown>): string {
  const digest = createHash('sha1').update(JSON.stringify(canonicalize(identity))).digest('hex');
  return `${VERDICT_KEY_PREFIX}${kind}:${digest}`;
}

function bounded<T>(call: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`verdict store call timed out after ${VERDICT_CALL_TIMEOUT_MS} ms`)),
      VERDICT_CALL_TIMEOUT_MS,
    );
    call.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function readVerdict<T>(
  kind: VerdictKind,
  identity: VerdictIdentity,
): Promise<T | undefined> {
  const redis = installed;
  if (!redis || identity === null) return undefined;
  try {
    const raw = await bounded(Promise.resolve(redis.get(verdictKey(kind, identity))));
    if (raw === null || raw === undefined) return undefined;
    return JSON.parse(raw) as T;
  } catch (error) {
    console.warn(`[verdict] read ${kind} failed, treating as a miss: ${describe(error)}`);
    return undefined;
  }
}

export async function writeVerdict(
  kind: VerdictKind,
  identity: VerdictIdentity,
  value: unknown,
): Promise<void> {
  const redis = installed;
  if (!redis || identity === null) return;
  try {
    await bounded(
      Promise.resolve(
        redis.set(verdictKey(kind, identity), JSON.stringify(value), 'EX', VERDICT_TTL_SECONDS),
      ),
    );
  } catch (error) {
    console.warn(`[verdict] write ${kind} failed, verdict not stored: ${describe(error)}`);
  }
}
