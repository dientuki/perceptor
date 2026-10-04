import { Injectable } from '@nestjs/common';
import { IndexerClient, TorrentResult } from './types';
import { HTTP_METHOD } from '@/types/http';
import { SettingsService } from '@/settings/settings.service';
import { ERROR_KEYS } from '@/i18n/error-keys';
import { i18nError } from '@/i18n/i18n-error';

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

  private async request(
    path: string,
    searchParams?: Record<string, string>,
  ): Promise<any> {
    const config = await this.settings.getMap();
    const baseUrl = `http://${config.tracker_host}:${config.tracker_port}/`;
    const url = new URL(path, baseUrl);
    for (const [key, value] of Object.entries(searchParams ?? {})) {
      url.searchParams.set(key, value);
    }

    let res: Response;
    try {
      res = await fetch(url.toString(), {
        method: HTTP_METHOD.GET,
        headers: {
          'X-Api-Key': config.tracker_api_key,
        },
      });
    } catch {
      throw i18nError.serviceUnavailable(ERROR_KEYS.INDEXER_UNAVAILABLE);
    }

    if (!res.ok) {
      throw i18nError.serviceUnavailable(ERROR_KEYS.INDEXER_UNAVAILABLE, {
        status: res.status,
      });
    }

    return res.json();
  }

  private async getData(query: string): Promise<any[]> {
    return this.request('/api/v1/search', { query });
  }

  async search(query: string): Promise<TorrentResult[]> {
    const data = await this.getData(query);
    const filteredData = await filterData(data);
    return filteredData;
  }

  // https://api.prowlarr.com/docs#/Indexer/get_api_v1_indexer — the configured-indexer list.
  async countIndexers(): Promise<number> {
    const data = await this.request('/api/v1/indexer');

    if (!Array.isArray(data)) {
      throw i18nError.serviceUnavailable(ERROR_KEYS.INDEXER_UNAVAILABLE);
    }

    return data.length;
  }
}
