import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RedisService } from '@/redis/redis.service';
import { SettingsService } from '@/settings/settings.service';
import type { SubtitleCandidate } from '@/subtitle-search/candidates';
import { HTTP_METHOD } from '@/types/http';
import { OpenSubtitlesHttpError } from './errors';
import { openSubtitlesApiKey } from './key';
import {
  OsDownloadResponse,
  OsLoginResponse,
  OsSearchParams,
  OsSearchResponse,
  OsSession,
} from './types';

const DEFAULT_HOST = 'api.opensubtitles.com';
const API_PREFIX = '/api/v1';
const TOKEN_TTL_SECONDS = 23 * 60 * 60;
const MAX_RATE_LIMIT_WAIT_MS = 10_000;
const DEFAULT_RATE_LIMIT_WAIT_MS = 1_000;

function packageVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, '../../../package.json'), 'utf8'),
    ) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const USER_AGENT = `Perceptor v${packageVersion()}`;

// Spec 107, REQ-5 REQ-8 REQ-9
@Injectable()
export class OpenSubtitlesClient {
  private readonly logger = new Logger(OpenSubtitlesClient.name);

  constructor(
    private readonly redis: RedisService,
    private readonly settings: SettingsService,
  ) {}

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async search(params: OsSearchParams): Promise<SubtitleCandidate[]> {
    const query = new URLSearchParams();
    if ('tmdbId' in params) {
      query.set('tmdb_id', String(params.tmdbId));
    } else {
      query.set('parent_tmdb_id', String(params.parentTmdbId));
      query.set('season_number', String(params.season));
      query.set('episode_number', String(params.episode));
    }
    query.set('languages', params.languages);
    if (params.moviehash) query.set('moviehash', params.moviehash);

    const body = await this.authed<OsSearchResponse>(
      HTTP_METHOD.GET,
      '/subtitles',
      query.toString(),
    );
    const candidates: SubtitleCandidate[] = [];
    for (const row of body.data ?? []) {
      const attributes = row.attributes;
      const files = attributes?.files ?? [];
      if (!attributes || files.length === 0) continue;
      candidates.push({
        id: String(files[0].file_id),
        release: attributes.release ?? '',
        fileCount: files.length,
        hearingImpaired: attributes.hearing_impaired === true,
        foreignPartsOnly: attributes.foreign_parts_only === true,
        machineTranslated: attributes.machine_translated === true,
        aiTranslated: attributes.ai_translated === true,
        hashMatch: attributes.moviehash_match === true,
        downloadCount: attributes.download_count ?? 0,
        fileName: files[0].file_name,
      });
    }
    return candidates;
  }

  async download(
    fileId: string | number,
  ): Promise<{ bytes: Buffer; remaining: number | null }> {
    const meta = await this.authed<OsDownloadResponse>(
      HTTP_METHOD.POST,
      '/download',
      '',
      { file_id: Number(fileId), sub_format: 'srt' },
    );
    if (!meta.link) {
      throw new OpenSubtitlesHttpError(
        'unavailable',
        HTTP_METHOD.POST,
        '/download',
        200,
      );
    }
    const res = await this.send(
      HTTP_METHOD.GET,
      meta.link,
      'download-link',
      { 'User-Agent': USER_AGENT },
    );
    if (!res.ok) this.fail(res.status, HTTP_METHOD.GET, 'download-link');
    return {
      bytes: Buffer.from(await res.arrayBuffer()),
      remaining: typeof meta.remaining === 'number' ? meta.remaining : null,
    };
  }

  private requireKey(): string {
    const key = openSubtitlesApiKey();
    if (key === null) {
      throw new OpenSubtitlesHttpError(
        'unauthorized',
        HTTP_METHOD.POST,
        '/login',
        0,
      );
    }
    return key;
  }

  private async authed<T>(
    method: string,
    path: string,
    query: string,
    body?: unknown,
  ): Promise<T> {
    const key = this.requireKey();
    let relogged = false;
    for (;;) {
      const session = await this.session(key);
      const url = `${session.baseUrl}${path}${query ? `?${query}` : ''}`;
      const res = await this.send(method, url, path, {
        ...this.baseHeaders(key),
        Authorization: `Bearer ${session.token}`,
      }, body);
      if (res.status === 401) {
        await this.dropSession(key);
        if (relogged) this.fail(401, method, path);
        relogged = true;
        continue;
      }
      if (!res.ok) this.fail(res.status, method, path, path === '/download');
      try {
        return (await res.json()) as T;
      } catch {
        throw new OpenSubtitlesHttpError('unavailable', method, path, res.status);
      }
    }
  }

  private baseHeaders(key: string): Record<string, string> {
    return {
      'Api-Key': key,
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  private async credentials(): Promise<{ username: string; password: string }> {
    const map = await this.settings.getMap();
    return {
      username: (map['opensubtitles_username'] ?? '').trim(),
      password: map['opensubtitles_password'] ?? '',
    };
  }

  private async session(key: string): Promise<OsSession> {
    const { username, password } = await this.credentials();
    const cacheKey = `opensubtitles:token:${createHash('sha256')
      .update(key + username + password)
      .digest('hex')}`;
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) return JSON.parse(cached) as OsSession;
    } catch {
      this.logger.warn('OpenSubtitles token cache unreadable');
    }

    const res = await this.send(
      HTTP_METHOD.POST,
      `https://${DEFAULT_HOST}${API_PREFIX}/login`,
      '/login',
      this.baseHeaders(key),
      { username, password },
    );
    if (!res.ok) this.fail(res.status, HTTP_METHOD.POST, '/login');
    let parsed: OsLoginResponse;
    try {
      parsed = (await res.json()) as OsLoginResponse;
    } catch {
      throw new OpenSubtitlesHttpError(
        'unavailable',
        HTTP_METHOD.POST,
        '/login',
        res.status,
      );
    }
    if (!parsed.token) {
      throw new OpenSubtitlesHttpError(
        'unavailable',
        HTTP_METHOD.POST,
        '/login',
        res.status,
      );
    }
    const session: OsSession = {
      token: parsed.token,
      baseUrl: `https://${parsed.base_url || DEFAULT_HOST}${API_PREFIX}`,
    };
    try {
      await this.redis.set(
        cacheKey,
        JSON.stringify(session),
        'EX',
        TOKEN_TTL_SECONDS,
      );
    } catch {
      this.logger.warn('OpenSubtitles token cache unwritable');
    }
    return session;
  }

  private async dropSession(key: string): Promise<void> {
    const { username, password } = await this.credentials();
    const cacheKey = `opensubtitles:token:${createHash('sha256')
      .update(key + username + password)
      .digest('hex')}`;
    try {
      await this.redis.del(cacheKey);
    } catch {
      this.logger.warn('OpenSubtitles token cache undeletable');
    }
  }

  // One fetch, plus a single bounded wait-and-retry on 429. Network failures
  // surface as `unavailable` with a fixed message, never the raw error.
  private async send(
    method: string,
    url: string,
    label: string,
    headers: Record<string, string>,
    body?: unknown,
  ): Promise<Response> {
    const attempt = async (): Promise<Response> => {
      try {
        return await fetch(url, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch {
        throw new OpenSubtitlesHttpError('unavailable', method, label, 0);
      }
    };
    const first = await attempt();
    if (first.status !== 429) return first;
    await this.sleep(this.rateLimitWaitMs(first));
    return attempt();
  }

  private rateLimitWaitMs(res: Response): number {
    const raw =
      res.headers?.get('retry-after') ?? res.headers?.get('ratelimit-reset');
    const seconds = raw === null || raw === undefined ? NaN : Number(raw);
    const ms = Number.isFinite(seconds)
      ? seconds * 1000
      : DEFAULT_RATE_LIMIT_WAIT_MS;
    return Math.max(0, Math.min(ms, MAX_RATE_LIMIT_WAIT_MS));
  }

  private fail(
    status: number,
    method: string,
    path: string,
    isDownload = false,
  ): never {
    let kind: OpenSubtitlesHttpError['kind'] = 'unavailable';
    if (status === 401) kind = 'unauthorized';
    else if (status === 406 && isDownload) kind = 'quota';
    else if (status === 429) kind = 'rate_limited';
    throw new OpenSubtitlesHttpError(kind, method, path, status);
  }
}
