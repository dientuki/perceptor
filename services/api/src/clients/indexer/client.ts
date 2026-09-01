import { Injectable } from '@nestjs/common';
import { IndexerClient, TorrentResult, TorrentInfo } from './types';
import { HTTP_METHOD } from '@/types/http';
import { getScore } from './score';
import { SettingsService } from '@/settings/settings.service';
import { ERROR_KEYS } from '@/i18n/error-keys';
import { i18nError } from '@/i18n/i18n-error';

// Some indexers (LimeTorrents is the one that surfaced this) never populate `infoHash` or
// `magnetUrl`, and their `guid` is a plain result-page URL with no embeddable hash — so a fetch
// of the item's own `downloadUrl` is the only way left to learn its real infoHash. That fetch is
// what `filterData` now runs for every otherwise-unresolvable item, so it needs a hard cap: one
// slow or dead host must not stall a search that also depends on healthy indexers.
const RESOLVE_INFO_HASH_TIMEOUT_MS = 8000;

async function resolveInfoHash(
  item: any,
  timeoutMs = RESOLVE_INFO_HASH_TIMEOUT_MS,
): Promise<string> {
  // 1️⃣ Si viene explícito
  if (item.infoHash) {
    return item.infoHash.toLowerCase();
  }

  // 2️⃣ Si viene magnet directo
  if (item.magnetUrl) {
    const match = item.magnetUrl.match(/xt=urn:btih:([^&]+)/i);
    if (match) return match[1].toLowerCase();
  }

  // 3️⃣ Si hay downloadUrl
  if (item.downloadUrl) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(item.downloadUrl, {
        redirect: 'manual',
        signal: controller.signal,
      });

      // 🔹 Si redirige a magnet
      if (response.status === 301 || response.status === 302) {
        const location = response.headers.get('location');
        if (location?.startsWith('magnet:')) {
          const match = location.match(/xt=urn:btih:([^&]+)/i);
          if (match) return match[1].toLowerCase();
        }
      }

      // 🔹 Si devuelve .torrent
      if (response.ok) {
        const buffer = Buffer.from(await response.arrayBuffer());
        const { default: parseTorrent } = await import('parse-torrent');
        const parsed = await parseTorrent(buffer);
        return parsed.infoHash.toLowerCase();
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw i18nError.badRequest(ERROR_KEYS.INDEXER_NO_INFOHASH);
}

async function filterIAData(items: any[]): Promise<TorrentInfo> {
  const filtered = items.filter((item) => item.title.includes('1080p'));

  filtered.forEach((item) => {
    item.score = getScore(item.title); // tu función de scoring
    item.downloadScore = item.seeders * 2 + item.leechers / 2; // o cualquier otra lógica que quieras para el score de descarga
  });

  const sorted = filtered.sort((a, b) => {
    // primero por score de calidad
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    // si tienen igual score, desempatar por disponibilidad
    return b.downloadScore - a.downloadScore;
  });

  const better = sorted[1];
  const infoHash = await resolveInfoHash(better);

  return Promise.resolve({
    downloadUrl: better.magnetUrl ?? better.downloadUrl ?? better.guid,
    infoHash: infoHash,
  });
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
  return match ? match[1].toUpperCase() : null;
}

async function filterData(items: Item[]): Promise<TorrentResult[]> {
  // 1) Agrupar inicialmente por infoHash
  const grouped = items.reduce((acc, item) => {
    const hash = item.infoHash?.toUpperCase() || 'NO_INFOHASH';

    if (!acc[hash]) {
      acc[hash] = [];
    }

    acc[hash].push(item);
    return acc;
  }, {} as GroupedItems);

  // 2) Sacar los que no tienen infoHash
  const noInfoHash = grouped['NO_INFOHASH'] || [];
  delete grouped['NO_INFOHASH'];

  // 3) Intentar rescatar hash desde guid
  const stillNoInfoHash: Item[] = [];

  for (const item of noInfoHash) {
    const guidHash = extractInfoHashFromGuid(item.guid);

    if (guidHash) {
      if (!grouped[guidHash]) {
        grouped[guidHash] = [];
      }

      grouped[guidHash].push({
        ...item,
        infoHash: guidHash,
      });
    } else {
      stillNoInfoHash.push(item);
    }
  }

  // 4) Los que ni tienen infoHash ni un guid con hash embebido (p.ej. LimeTorrents, cuyo guid es
  //    la URL de la página del resultado) sólo pueden resolverse pidiendo su propio downloadUrl —
  //    resolveInfoHash ya sabe seguir el redirect a magnet o parsear el .torrent que devuelva. Se
  //    resuelven todos en paralelo, cada uno con su propio timeout, para que un indexer lento o
  //    caído nunca bloquee el resto de la búsqueda. Antes este bloque estaba comentado y estos
  //    items simplemente se descartaban — lo que hacía desaparecer un indexer entero de todas las
  //    búsquedas, en silencio, sin ningún error.
  if (stillNoInfoHash.length > 0) {
    const resolved = await Promise.allSettled(
      stillNoInfoHash.map(async (item) => ({
        item,
        infoHash: (await resolveInfoHash(item)).toUpperCase(),
      })),
    );

    for (const outcome of resolved) {
      // Un link muerto o un .torrent que no parsea deja el release sin forma de agregarse de
      // todos modos, así que se descarta igual que antes — pero ahora sólo ése, no el indexer
      // entero.
      if (outcome.status !== 'fulfilled') continue;

      const { item, infoHash } = outcome.value;
      if (!grouped[infoHash]) {
        grouped[infoHash] = [];
      }
      grouped[infoHash].push({ ...item, infoHash });
    }
  }

  // 5) Transformar cada grupo al formato final
  const result: TorrentResult[] = Object.entries(grouped).map(
    ([infoHash, group]) => {
      const first = group[0];

      return {
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
