// search/searchFactory.ts
import { createMovieDBClient } from "@/clients/MovieDB/createMovieDBClient";
import { createMovieSearchStrategy } from "./tmdb/createMovieSearchStrategy";
import { createTVSearchStrategy } from "./tmdb/createTVSearchStrategy";
import { MEDIA_TYPE, MediaType, SearchStrategy } from "./types";

const STRATEGY_MAP = {
  [MEDIA_TYPE.MOVIE]: createMovieSearchStrategy,
  [MEDIA_TYPE.TV]: createTVSearchStrategy,
} as const;

export const getSearchStrategy = async (
  type: MediaType, 
): Promise<SearchStrategy> => {
  
  const movieClient = await createMovieDBClient();

  const createStrategy = STRATEGY_MAP[type];

  if (!createStrategy) {
    throw new Error(`No existe una estrategia para el tipo: ${type}`);
  }

  return createStrategy(movieClient)
};