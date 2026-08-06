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

const GET_MOVIE_QUERY = `
  query GetMovie($id: Int!) {
    movie(id: $id) {
      id
      tmdbId
      title
      overview
      posterUrl
      releaseDate
      originalLanguage
      isLiveAction
      status
    }
  }
`;

export async function getMovieById(id: number): Promise<Movie | null> {
  const { data, errors } = await fetchGraphQL<{ movie: Movie | null }>(GET_MOVIE_QUERY, { id });

  if (errors && errors.length > 0) {
    throw new Error(errors[0]?.message || 'Error al obtener la película');
  }

  // El API devuelve null cuando el id no existe; la página lo traduce a notFound()
  return data?.movie ?? null;
}

const ADD_MOVIE_MUTATION = `
  mutation AddMovie($tmdbId: Int!) {
    addMovie(tmdbId: $tmdbId) {
      id
    }
  }
`;

export async function addMovie(tmdbId: number, type: MediaType): Promise<number> {
  const { data, errors } = await fetchGraphQL<{ addMovie: { id: number } }>(
    ADD_MOVIE_MUTATION,
    { tmdbId },
  );

  if (errors && errors.length > 0) {
    throw new Error(errors[0]?.message || 'Error al agregar la película');
  }

  const id = data?.addMovie?.id;
  if (!id) throw new Error('El API no devolvió el id de la película');

  return id;
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