import { IndexerClient } from "./types";
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

async function filterData(items: any[]): Promise<TorrentInfo> {
  
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
    //console.log('tracker:', trackerClient);
    //console.log(res);
    const data = await res.json();
    //const file = await fs.readFile("./mi7.json", "utf-8");
    //const data = JSON.parse(file);

    //console.log(data);
    return data;
  }

  return {

    async search(query: string): Promise<TorrentInfo> {
      const data = await getData(query);
      const filteredData = filterData(data);
      return filteredData;
    }
  }
}