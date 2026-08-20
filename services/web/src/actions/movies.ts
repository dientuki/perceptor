"use server";

import { redirectToClearSession } from "@/lib/auth-session";
import { fetchGraphQL } from "@/lib/graphql-client";
import { translateGraphQLError } from "@/lib/graphql-error";
import type { Language } from "@/types/languages";

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
  preferredLanguages: Language[];
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
    // Called directly from MoviesPage's Server Component render — cookie
    // mutation is illegal there, so hand off to the Route Handler instead of
    // redirectIfUnauthenticated (which throws by mutating cookies).
    redirectToClearSession(errors);
    // Any other error: log it server-side and fall back to an empty list,
    // matching what the client component's try/catch used to do silently —
    // there is no app/(dashboard)/error.tsx, so letting this throw would
    // surface Next's default error screen instead of the empty state.
    console.error("Failed to fetch movies:", errors[0]?.message);
    return [];
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
      preferredLanguages {
        id
        iso2
        name
      }
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
    // to the Route Handler instead of mutating the cookie in-process.
    redirectToClearSession(errors);
    throw new Error(await translateGraphQLError(errors[0]));
  }

  // El API devuelve null cuando el id no existe; la página lo traduce a notFound()
  return data?.movie ?? null;
}
