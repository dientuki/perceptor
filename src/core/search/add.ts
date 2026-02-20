import { logger } from "@/lib/logger";
import { getSetting } from "@/models/settings.model";

export async function addTorrent(url: string) {

  logger.info(
    { url },
    'Agregando torrent:'
  );

  const torrentClient = await getSetting(["torrent_host", "torrent_port"]);

  const host = torrentClient.torrent_host ?? "localhost";
  const port = torrentClient.torrent_port ?? "8080";

  // Construimos la URL correctamente
  const endpoint = new URL("/api/v2/torrents/add", `http://${host}:${port}`);

  await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      urls: url
    })
  });
}