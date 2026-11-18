import { Injectable } from '@nestjs/common';
import { SettingsService } from '@/settings/settings.service';
import { HTTP_METHOD } from '@/types/http';
import { boundedRetryAfterMs } from '../retry-after';
import {
  SubtitleProviderErrorKind,
  SubtitleProviderHttpError,
} from '../subtitle-provider-error';
import {
  SubdivxDownload,
  SubdivxItem,
  SubdivxSearchParams,
  SubdivxSearchResponse,
} from './types';

// https://subx-api.duckdns.org/docs
const BASE_URL = 'https://subx-api.duckdns.org/api';
const SEARCH_LIMIT = 200;
const MAX_RATE_LIMIT_WAIT_MS = 10_000;
const DEFAULT_RATE_LIMIT_WAIT_MS = 1_000;

function subdivxError(
  kind: SubtitleProviderErrorKind,
  method: string,
  path: string,
  status: number,
): SubtitleProviderHttpError {
  return new SubtitleProviderHttpError('subdivx', kind, method, path, status);
}

// Spec 121, REQ-10
export class SubdivxCandidateFetchError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
  ) {
    super(`subdivx download ${path} failed: ${status} (candidate)`);
    this.name = 'SubdivxCandidateFetchError';
  }
}

// Spec 121, REQ-10
export function parseContentDisposition(header: string | null): string | null {
  if (!header) return null;
  const extended = /filename\*\s*=\s*(?:[\w-]+'[^']*')?([^;]+)/i.exec(header);
  let raw: string | null = null;
  if (extended) {
    try {
      raw = decodeURIComponent(extended[1].trim().replace(/^"|"$/g, ''));
    } catch {
      raw = null;
    }
  }
  if (raw === null) {
    const plain = /filename\s*=\s*(?:"([^"]*)"|([^;]+))/i.exec(header);
    if (plain) raw = (plain[1] ?? plain[2]).trim();
  }
  if (!raw) return null;
  const base = raw.split(/[\\/]/).pop()?.trim();
  return base ? base : null;
}

// Spec 121, REQ-10
@Injectable()
export class SubdivxClient {
  constructor(private readonly settings: SettingsService) {}

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async search(params: SubdivxSearchParams): Promise<SubdivxItem[]> {
    const query = new URLSearchParams();
    if (params.imdbId) query.set('imdb_id', params.imdbId);
    if (params.title) query.set('title', params.title);
    if (params.year !== undefined) query.set('year', String(params.year));
    if (params.query) query.set('query', params.query);
    query.set('limit', String(SEARCH_LIMIT));

    const path = '/subtitles/search';
    const res = await this.send(path, query.toString());
    if (!res.ok) this.fail(res.status, path);
    try {
      const body = (await res.json()) as SubdivxSearchResponse;
      return Array.isArray(body.items) ? body.items : [];
    } catch {
      throw subdivxError('unavailable', HTTP_METHOD.GET, path, res.status);
    }
  }

  async download(id: string | number): Promise<SubdivxDownload> {
    const path = '/subtitles/{id}/download';
    const res = await this.send(
      `/subtitles/${encodeURIComponent(String(id))}/download`,
      '',
      path,
    );
    if (!res.ok) {
      if ([400, 404, 502].includes(res.status)) {
        throw new SubdivxCandidateFetchError(res.status, path);
      }
      this.fail(res.status, path);
    }
    return {
      bytes: Buffer.from(await res.arrayBuffer()),
      fileName: parseContentDisposition(
        res.headers.get('content-disposition'),
      ),
    };
  }

  private async key(path: string): Promise<string> {
    const map = await this.settings.getMap();
    const key = (map['subdivx_api_key'] ?? '').trim();
    if (key === '') throw subdivxError('unauthorized', HTTP_METHOD.GET, path, 0);
    return key;
  }

  // One fetch, plus a single bounded wait-and-retry on 429. Network failures
  // surface as `unavailable` with a fixed message, never the raw error.
  private async send(
    path: string,
    query: string,
    label: string = path,
  ): Promise<Response> {
    const key = await this.key(label);
    const url = `${BASE_URL}${path}${query ? `?${query}` : ''}`;
    const attempt = async (): Promise<Response> => {
      try {
        return await fetch(url, {
          method: HTTP_METHOD.GET,
          headers: { Authorization: `Bearer ${key}`, Accept: '*/*' },
        });
      } catch {
        throw subdivxError('unavailable', HTTP_METHOD.GET, label, 0);
      }
    };
    const first = await attempt();
    if (first.status !== 429) return first;
    await this.sleep(
      boundedRetryAfterMs(
        first,
        MAX_RATE_LIMIT_WAIT_MS,
        DEFAULT_RATE_LIMIT_WAIT_MS,
      ),
    );
    return attempt();
  }

  private fail(status: number, path: string): never {
    let kind: SubtitleProviderErrorKind = 'unavailable';
    if (status === 401 || status === 403) kind = 'unauthorized';
    else if (status === 429) kind = 'rate_limited';
    throw subdivxError(kind, HTTP_METHOD.GET, path, status);
  }
}
