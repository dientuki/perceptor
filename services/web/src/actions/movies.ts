'use server'

import { fetchGraphQL } from '@/lib/graphql-client';
import { MediaType } from '@/types/media';
import { MediaSearchResult } from '@/types/search';


export interface Movie {
  id: string;
  tmdbId: number;
  title: string;
  overview?: string;
  posterUrl?: string;
  releaseDate?: string;
  originalLanguage: string;
  isLiveAction: boolean;
  status: string;
}

export async function getMovies(): Promise<Movie[]> {
  const query = `
    query GetStoredMovies {
      movies {
        id
        overview
        title
        posterUrl
        releaseDate
      }
    }
  `;

  const { data, errors } = await fetchGraphQL<{ movies: Movie[] }>(query);

  // GraphQL responde 200 con `errors` poblado: sin este chequeo `data` viene undefined
  if (errors && errors.length > 0) {
    throw new Error(errors[0]?.message || 'Error al obtener películas');
  }

  return data?.movies ?? [];
}

export async function addMovie(id: any, type: MediaType): Promise<boolean> {
  return true
}

const SEARCH_MOVIES_QUERY = `
  query SearchMovies($query: String!) {
    searchMovies(query: $query) {
      id
      title
      releaseDate
      posterUrl
      originalLanguage
      overview
      type
    }
  }
`;

export async function searchMovies(query: string): Promise<MediaSearchResult[]> {
  // El API ya corta con [] en query vacía, pero evitamos el round trip
  if (!query.trim()) return [];

  const { data, errors } = await fetchGraphQL<{ searchMovies: MediaSearchResult[] }>(
    SEARCH_MOVIES_QUERY,
    { query },
  );

  // GraphQL responde 200 con `errors` poblado: hay que mirarlo explícitamente
  if (errors && errors.length > 0) {
    throw new Error(errors[0]?.message || 'Error al buscar películas');
  }

  return data?.searchMovies ?? [];
}