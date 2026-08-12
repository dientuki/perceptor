"use server";

import {
  redirectIfUnauthenticated,
  redirectToClearSession,
} from "@/lib/auth-session";
import { fetchGraphQL } from "@/lib/graphql-client";

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
    await redirectIfUnauthenticated(errors);
    throw new Error(errors[0]?.message || "Error al obtener películas");
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
  const { data, errors } = await fetchGraphQL<{ movie: Movie | null }>(
    GET_MOVIE_QUERY,
    { id },
  );

  if (errors && errors.length > 0) {
    // Called directly from MovieDetailsPage's Server Component render (and
    // its generateMetadata) — cookie mutation is illegal there, so hand off
    // to the Route Handler instead of redirectIfUnauthenticated (still used
    // below, in the form actions, where it's legal).
    redirectToClearSession(errors);
    throw new Error(errors[0]?.message || "Error al obtener la película");
  }

  // El API devuelve null cuando el id no existe; la página lo traduce a notFound()
  return data?.movie ?? null;
}
