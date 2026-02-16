import fetch from 'node-fetch'
import fs from "fs/promises";
import { getScore } from "@/core/search/score";

const PROXY_API_KEY = process.env.PROXY_API_KEY;
const PROXY_DOMAIN = process.env.PROXY_DOMAIN;
const PROXY_PORT = process.env.PROXY_PORT;

async function getData(query: string): Promise<any[]> {
  const url = new URL("/api/v1/search", `http://${PROXY_DOMAIN}:${PROXY_PORT}`);
  url.searchParams.set("query", query);

  console.log("Realizando búsqueda en proxy:", url.toString());

  //const res = await fetch(url, {
  //  method: "GET",
  //  headers: {
  //    "X-Api-Key": PROXY_API_KEY,
  //  },
  //});
  //const data = await res.json();
  const file = await fs.readFile("./mi7.json", "utf-8");
  const data = JSON.parse(file);

  //console.log(data);
  return data;
}

function filterData(items: any[]): Promise<string> {
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

  console.log("Mejor resultado:", better);

  return better.magnetUrl ?? better.downloadUrl ?? better.guid;
}

export async function search(query: string): Promise<string> {
  const data = await getData(query);
  const filteredData = filterData(data);
  return filteredData;
}