import { MovieDBClient } from "@/clients/MovieDB/types";
import { SearchStrategy, MediaSearchResult, MEDIA_TYPE } from "../types";

interface TmdbRawTv {
  id: number;
  name: string;
  first_air_date: string;
  poster_path: string | null;
  original_language: string;
  overview: string;
}

export const createTVSearchStrategy = (movieDBClient: MovieDBClient): SearchStrategy => ({
  async execute(query: string): Promise<MediaSearchResult[]> {
    const results = await movieDBClient.search<TmdbRawTv>("tv", query);

    return results.map(item => ({
      id: item.id,
      title: item.name,       // TS sabe que 'name' existe porque usamos <TmdbRawTv>
      releaseDate: item.first_air_date,
      posterUrl: item.poster_path ? `https://image.tmdb.org/t/p/w300${item.poster_path}` : null,
      originalLanguage: item.original_language,
      description: item.overview,
      type: MEDIA_TYPE.TV
    }));
  }
});