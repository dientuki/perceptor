import { MOVIEDB_CLIENTS, MovieDBClient } from "./types";
import { createTMDBClient } from "./createTMDBClient";
import { getSetting } from "@/models/settings.model";

export async function createMovieDBClient(): Promise<MovieDBClient> {
  const config: Record<string, string> = await getSetting([
    "movie_db_client", "movie_db_host", "movie_db_api_key"
  ]);

  if (config.media_server_client === MOVIEDB_CLIENTS.TMDB) {
    return createTMDBClient(config);
  }

  //if (config.torrent_client === "transmission") {
  //  return createTransmissionStrategy(config);
  //}

  throw new Error("Unsupported media server client");
}