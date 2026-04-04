import { IndexerClient, TorrentResult } from "./types";
import { HTTP_METHOD } from "@/types/http";
import { logger } from "@/lib/logger";
import parseTorrent from "parse-torrent";
import { getScore } from "./score";
import fs from "fs/promises";

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

  logger.info(
    { better, infoHash },
    "Mejor resultado encontrado:"
  );

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


export const createProwlarrClient = (config : Record<string, string>): IndexerClient => {
  
  const host = config.tracker_host ?? "localhost";
  const port = config.tracker_port ?? "8096";

  const api_key = config.tracker_api_key;

  const baseUrl = `http://${host}:${port}/`;

  async function getData(query: string): Promise<any[]> {
    const url = new URL("/api/v1/search", baseUrl);
    url.searchParams.set("query", query);

    logger.info(
      { url },
      "Realizando búsqueda en proxy Prowlarr:"
    );

    const res = await fetch(url.toString(), {
      method: HTTP_METHOD.GET,
      headers: {
        "X-Api-Key": api_key,
      },
    });
    //console.log('tracker:');
    //console.log(res);
    const data = await res.json();
    //const file = await fs.readFile("./mi7.json", "utf-8");
    //const data = JSON.parse(file);

    //console.log(data);
    return data;
  }

  return {

    async search(query: string): Promise<TorrentResult[]> {
      const data = await getData(query);
      const filteredData = await filterData(data);
      //const filteredData = filterData(data);
      return filteredData;
    },

    //async searchIA(query: string): Promise<TorrentInfo> {
    //  const data = await getData(query);
    //  const filteredData = filterIAData(data);
    //  return filteredData;
    //},

  }
}