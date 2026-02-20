import fetch from 'node-fetch'
import fs from "fs/promises";
import { getScore } from "@/core/search/score";
import { getSetting } from "@/models/settings.model";
import { logger } from "@/lib/logger";

async function getData(query: string): Promise<any[]> {
  const trackerClient = await getSetting(["tracker_host", "tracker_port", "tracker_api_key"]);
  
  const host = trackerClient.tracker_host ?? "localhost";
  const port = trackerClient.tracker_port ?? "9696";

  const url = new URL("/api/v1/search", `http://${host}:${port}`);
  url.searchParams.set("query", query);

  logger.info(
    { url },
    "Realizando búsqueda en proxy:"
  );

  //const res = await fetch(url, {
  //  method: "GET",
  //  headers: {
  //    "X-Api-Key": trackerClient.tracker_api_key,
  //  },
  //});
  //const data = await res.json();
  const file = await fs.readFile("./mi7.json", "utf-8");
  const data = JSON.parse(file);

  //console.log(data);
  return data;
}

function filterData(items: any[]): Promise<TorrentInfo> {
  
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

  logger.info(
    { better },
    "Mejor resultado encontrado:"
  );

  return Promise.resolve({
    downloadUrl: better.magnetUrl ?? better.downloadUrl ?? better.guid,
    infoHash: better.infoHash
  });
}

export async function search(query: string): Promise<TorrentInfo> {
  const data = await getData(query);
  const filteredData = filterData(data);
  return filteredData;
}