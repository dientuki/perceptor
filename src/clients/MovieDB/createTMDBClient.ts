import { MovieDBClient, MovieDBSearch } from "./types";
import { HTTP_METHOD } from "@/types/http";

interface TmdbSearchResponse {
  page: number;
  results: TmdbResults[];
  total_pages: number;
  total_results: number;
}

interface TmdbBase {
  adult: boolean;
  backdrop_path: string;
  genre_ids: number[];
  id: number;
  original_language: string;
  overview: string;
  popularity: number;
  poster_path: string | null;
  vote_average: number;
  vote_count: number; 
}

interface TmdbMovie extends TmdbBase {
  original_title: string;
  release_date: string;       // Fecha de estreno
  title: string;
  video: boolean;
}

interface TmdbTv extends TmdbBase {
  origin_country: string[];   // Países de origen
  original_name: string;
  first_air_date: string;
  name: string;
}

interface TmdbMulti extends TmdbBase {
  title: string;
  original_title: string;
  media_type: string;
  release_date: string;       // Fecha de estreno
  video: boolean;
}

type TmdbResults = TmdbMovie | TmdbTv | TmdbMulti;

export const createTMDBClient = (config : Record<string, string>): MovieDBClient => {
  
  const host = config.movie_db_host ?? "localhost";
  const apiVersion = "3";

  const api_key = config.movie_db_api_key;

  const baseUrl = host;

  const options = {
    method: HTTP_METHOD.GET,
    headers: {
      accept: 'application/json',
      Authorization: `Bearer ${api_key}`
    }
  };

  async function fetchPage<T>(endpoint: string, query: string, page: number = 1): Promise<T[]> {
    const urlPath = new URL(`${apiVersion}/${endpoint}`, baseUrl);
    urlPath.searchParams.set("query", query);
    urlPath.searchParams.set("page", page.toString());
    
    const res = await fetch(urlPath.toString(), options)

    const data = await res.json();
    return (data.results || []) as T[];
    
  }

  return {
    // 'thing' sería "movie", "tv", "person", "multi", etc.
    async search<T>(thing: string, query: string, page: number = 1): Promise<T[]> {
      return await fetchPage(`search/${thing}`, query, page) as T[];
    }
  };
  /*

  return {
    async fetchAllTmdbPages<T>({ endpoint, query }: MovieDBSearch): Promise<T[]> {
      let page = 1
      let totalPages = 1
      const results: TmdbResults[] = [];
    
      const urlPath = new URL(`${apiVersion}/${endpoint}`, baseUrl);
      urlPath.searchParams.set("query", query);
      urlPath.searchParams.set("page", page.toString());
    
      do {
        const res = await fetch(urlPath.toString(), options)
        const data = (await res.json()) as TmdbSearchResponse;
    
        if (!data || !data.results) break
    
        results.push(...data.results)
    
        totalPages = data.total_pages ?? 1
        page++
        urlPath.searchParams.set("page",page.toString());
      } while (page <= totalPages)
    
      //console.log(results);
    
      return results as T[]
    },

    async fetchPage<T>(endpoint: string, query: string, page: number = 1): Promise<T[]> {
      const urlPath = new URL(`${apiVersion}/${endpoint}`, baseUrl);
      urlPath.searchParams.set("query", query);
      urlPath.searchParams.set("page", page.toString());
      
      const res = await fetch(urlPath.toString(), options)

      return await res.json() as T[];
    }
    
  };
  */
}