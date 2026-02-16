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

type TmdbSearch = {
  endpoint: string;
  query: string;
};