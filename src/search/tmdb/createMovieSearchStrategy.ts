import { MovieDBClient } from "@/clients/MovieDB/types";
import { SearchStrategy , MediaSearchResult, MEDIA_TYPE} from "../types";

interface TmdbRawMovie {
  id: number;
  title: string;
  release_date: string;
  poster_path: string | null;
  original_language: string;
  overview: string;
}

export const createMovieSearchStrategy = (movieDBClient: MovieDBClient): SearchStrategy => ({
  async execute(query: string): Promise<MediaSearchResult[]> {
    const results = await movieDBClient.search<TmdbRawMovie>("movie", query);

    return results.map(item => ({
      id: item.id,
      title: item.title,
      releaseDate: item.release_date,
      posterUrl: item.poster_path ? `https://image.tmdb.org/t/p/w300${item.poster_path}` : null,
      originalLanguage: item.original_language,
      description: item.overview,
      type: MEDIA_TYPE.MOVIE
    }));
  }
});