import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { IndexerClient, TorrentResult, TorrentInfo } from "./types";
import { HTTP_METHOD } from "@/types/http";
import { getScore } from "./score";
import { SettingsService } from '@/settings/settings.service';

async function resolveInfoHash(item: any): Promise<string> {
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
    const response = await fetch(item.downloadUrl, {
      redirect: "manual"
    });

    // 🔹 Si redirige a magnet
    if (response.status === 301 || response.status === 302) {
      const location = response.headers.get("location");
      if (location?.startsWith("magnet:")) {
        const match = location.match(/xt=urn:btih:([^&]+)/i);
        if (match) return match[1].toLowerCase();
      }
    }

    // 🔹 Si devuelve .torrent
    if (response.ok) {
      const buffer = Buffer.from(await response.arrayBuffer());
      const { default: parseTorrent } = await import("parse-torrent");
      const parsed = await parseTorrent(buffer);
      return parsed.infoHash.toLowerCase();
    }
  }

  throw new Error("No se pudo resolver infoHash");
}

async function filterIAData(items: any[]): Promise<TorrentInfo> {

  const filtered = items.filter(item => item.title.includes("1080p"))

  filtered.forEach(item => {
    item.score = getScore(item.title) // tu función de scoring
    item.downloadScore = item.seeders * 2 + item.leechers / 2 // o cualquier otra lógica que quieras para el score de descarga
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
    infoHash: infoHash
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
    const hash = item.infoHash?.toUpperCase() || "NO_INFOHASH";

    if (!acc[hash]) {
      acc[hash] = [];
    }

    acc[hash].push(item);
    return acc;
  }, {} as GroupedItems);

  // 2) Sacar los que no tienen infoHash
  const noInfoHash = grouped["NO_INFOHASH"] || [];
  delete grouped["NO_INFOHASH"];

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

  // 4) Si querés conservar los que siguen sin hash, podés volver a meterlos
  //    (si NO los querés, podés borrar este bloque)
  //if (stillNoInfoHash.length > 0) {
  //  grouped["NO_INFOHASH"] = stillNoInfoHash;
  //}

  // 5) Transformar cada grupo al formato final
  const result: TorrentResult[] = Object.entries(grouped).map(([infoHash, group]) => {
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
  });

  return result.sort((a, b) => (b.size ?? 0) - (a.size ?? 0));
}

@Injectable()
export class ProwlarrClient implements IndexerClient {
  constructor(private readonly settings: SettingsService) {}

  private async getData(query: string): Promise<any[]> {
    const config = await this.settings.getMap();
    const baseUrl = `http://${config.tracker_host}:${config.tracker_port}/`;
    const url = new URL("/api/v1/search", baseUrl);
    url.searchParams.set("query", query);

    let res: Response;
    try {
      res = await fetch(url.toString(), {
        method: HTTP_METHOD.GET,
        headers: {
          "X-Api-Key": config.tracker_api_key,
        },
      });
    } catch {
      throw new ServiceUnavailableException('No se pudo consultar el indexer');
    }

    if (!res.ok) {
      throw new ServiceUnavailableException(`No se pudo consultar el indexer (HTTP ${res.status})`);
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
