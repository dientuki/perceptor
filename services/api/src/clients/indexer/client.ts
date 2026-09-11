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

// A derived group key for a release with no infoHash and no hash embedded in its guid. Built
// from the normalized title plus the size, so a byte-exact duplicate reported by several
// indexers still collapses to one row (REQ-2, AC-6), while two genuinely different releases that
// merely share a title do not collide.
function deriveGroupKey(item: Item): string {
  const normalizedTitle = (item.title ?? '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
  return `NOHASH:${normalizedTitle}:${item.size ?? 0}`;
}

// Groups Prowlarr's rows into one output row per release. A row carries an infoHash directly, a
// hash embeddable from its `guid`, or neither — in which case it falls back to a derived key so
// it is still returned (REQ-1) instead of being resolved (and possibly discarded) here. No
// outbound fetch is ever issued during a search (REQ-3); the infoHash for a hash-less row is
// resolved lazily, once, when the release is actually added.
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

  private async getData(query: string): Promise<any[]> {
    const config = await this.settings.getMap();
    const baseUrl = `http://${config.tracker_host}:${config.tracker_port}/`;
    const url = new URL('/api/v1/search', baseUrl);
    url.searchParams.set('query', query);

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

    const data = await res.json();

    return data;
  }

  async search(query: string): Promise<TorrentResult[]> {
    const data = await this.getData(query);
    const filteredData = await filterData(data);
    return filteredData;
  }
}
