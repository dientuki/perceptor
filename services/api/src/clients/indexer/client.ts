import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  IndexerClient,
  ProwlarrAppProfile,
  ProwlarrIndexer,
  ProwlarrSchemaEntry,
  ProwlarrTag,
  TorrentResult,
} from './types';
import { HTTP_METHOD, HttpMethod } from '@/types/http';
import { SettingsService } from '@/settings/settings.service';
import { ERROR_KEYS } from '@/i18n/error-keys';
import { i18nError } from '@/i18n/i18n-error';

const ERROR_DETAIL_MAX = 300;

// Spec 112, api/plan.md Step 2: still a 503 indexer-unavailable to any caller that does not look,
// but carries the upstream status so the service can tell a create 400 from an outage.
export class IndexerHttpError extends ServiceUnavailableException {
  constructor(
    readonly upstreamStatus: number,
    readonly detail: string,
  ) {
    super(
      i18nError
        .serviceUnavailable(ERROR_KEYS.INDEXER_UNAVAILABLE, { status: upstreamStatus })
        .getResponse(),
    );
  }
}

type Item = {
  infoHash?: string;
  guid?: string;
  title?: string;
  size?: number;
  seeders?: number;
  leechers?: number;
  magnetUrl?: string;
  downloadUrl?: string;
  [key: string]: any;
};

type GroupedItems = Record<string, Item[]>;

function extractInfoHashFromGuid(guid?: string): string | null {
  if (!guid) return null;

  const match = guid.match(/\b([A-Fa-f0-9]{40})\b/);
  return match ? match[1].toLowerCase() : null;
}

// Spec 037, REQ-2 AC-6
function deriveGroupKey(item: Item): string {
  const normalizedTitle = (item.title ?? '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
  return `NOHASH:${normalizedTitle}:${item.size ?? 0}`;
}

// Spec 037, REQ-1; Spec 037, REQ-3
async function filterData(items: Item[]): Promise<TorrentResult[]> {
  const grouped: GroupedItems = {};

  for (const item of items) {
    const hash =
      item.infoHash?.toLowerCase() ||
      extractInfoHashFromGuid(item.guid) ||
      deriveGroupKey(item);

    if (!grouped[hash]) {
      grouped[hash] = [];
    }
    grouped[hash].push(item);
  }

  const result: TorrentResult[] = Object.entries(grouped).map(
    ([key, group]) => {
      const first = group[0];
      const infoHash = key.startsWith('NOHASH:') ? null : key;

      return {
        id: key,
        infoHash,
        title: first?.title ?? null,
        size: first?.size ?? null,
        seeders: group.reduce((sum, item) => sum + (item.seeders ?? 0), 0),
        leechers: group.reduce((sum, item) => sum + (item.leechers ?? 0), 0),
        items: group.map((item) => ({
          downloadUrl: item.magnetUrl ?? item.downloadUrl ?? item.guid ?? null,
        })),
        infoUrl: group.map((item) => ({
          downloadUrl: item.infoUrl ?? null,
        })),
      };
    },
  );

  return result.sort((a, b) => (b.size ?? 0) - (a.size ?? 0));
}

@Injectable()
export class ProwlarrClient implements IndexerClient {
  constructor(private readonly settings: SettingsService) {}

  // Spec 112, api/plan.md Steps 2-3
  private async request(
    path: string,
    options: {
      method?: HttpMethod;
      query?: Record<string, string>;
      body?: unknown;
    } = {},
  ): Promise<any> {
    const method = options.method ?? HTTP_METHOD.GET;
    const config = await this.settings.getMap();
    const baseUrl = `http://${config.tracker_host}:${config.tracker_port}/`;
    const url = new URL(path, baseUrl);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(key, value);
    }

    const headers: Record<string, string> = {
      'X-Api-Key': config.tracker_api_key,
    };
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    let res: Response;
    try {
      res = await fetch(url.toString(), {
        method,
        headers,
        ...(options.body !== undefined
          ? { body: JSON.stringify(options.body) }
          : {}),
      });
    } catch {
      throw i18nError.serviceUnavailable(ERROR_KEYS.INDEXER_UNAVAILABLE);
    }

    if (!res.ok) {
      let detail = '';
      try {
        if (typeof res.text === 'function') {
          detail = (await res.text()).slice(0, ERROR_DETAIL_MAX);
        }
      } catch {
        detail = '';
      }
      throw new IndexerHttpError(res.status, detail);
    }

    if (method === HTTP_METHOD.DELETE) {
      return undefined;
    }

    return res.json();
  }

  private async list<T>(path: string): Promise<T[]> {
    const data = await this.request(path);

    if (!Array.isArray(data)) {
      throw i18nError.serviceUnavailable(ERROR_KEYS.INDEXER_UNAVAILABLE);
    }

    return data as T[];
  }

  private async getData(query: string): Promise<any[]> {
    return this.request('/api/v1/search', { query: { query } });
  }

  async search(query: string): Promise<TorrentResult[]> {
    const data = await this.getData(query);
    const filteredData = await filterData(data);
    return filteredData;
  }

  // https://api.prowlarr.com/docs#/Indexer/get_api_v1_indexer — the configured-indexer list.
  async countIndexers(): Promise<number> {
    const data = await this.list('/api/v1/indexer');
    return data.length;
  }

  async getIndexerSchema(): Promise<ProwlarrSchemaEntry[]> {
    return this.list<ProwlarrSchemaEntry>('/api/v1/indexer/schema');
  }

  async listIndexers(): Promise<ProwlarrIndexer[]> {
    return this.list<ProwlarrIndexer>('/api/v1/indexer');
  }

  // A failing connection test answers 400 (IndexerHttpError with status 400), not an outage.
  async createIndexer(body: Record<string, unknown>): Promise<ProwlarrIndexer> {
    return this.request('/api/v1/indexer', {
      method: HTTP_METHOD.POST,
      body,
    });
  }

  // Prowlarr answers 200 for an unknown id; the existence check belongs to the caller.
  async deleteIndexer(id: number): Promise<void> {
    await this.request(`/api/v1/indexer/${encodeURIComponent(String(id))}`, {
      method: HTTP_METHOD.DELETE,
    });
  }

  async listTags(): Promise<ProwlarrTag[]> {
    return this.list<ProwlarrTag>('/api/v1/tag');
  }

  async listAppProfiles(): Promise<ProwlarrAppProfile[]> {
    return this.list<ProwlarrAppProfile>('/api/v1/appprofile');
  }
}
