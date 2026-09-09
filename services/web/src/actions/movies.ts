"use server";

import { getTranslations } from "next-intl/server";
import {
  redirectIfUnauthenticated,
  redirectToClearSession,
} from "@/lib/auth-session";
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
  isShort: boolean;
  status: string;
  audioLanguages: Language[];
  subtitleLanguages: Language[];
  audioMandatory: boolean;
}

export async function getMovies(isShort?: boolean): Promise<Movie[]> {
  const query = `
    query GetStoredMovies($isShort: Boolean) {
      movies(isShort: $isShort) {
        id
        overview
        title
        posterUrl
        releaseDate
      }
    }
  `;

  // The GraphQL argument is optional and tri-state: omitted/null means
  // "every film the caller owns" (spec REQ-8/REQ-11). `undefined` here is
  // stripped by fetchGraphQL's variable serialization the same way as not
  // sending the key at all.
  const { data, errors } = await fetchGraphQL<{ movies: Movie[] }>(query, {
    isShort,
  });

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
      isShort
      status
      audioLanguages {
        id
        tag
        iso2
        iso3
        name
      }
      subtitleLanguages {
        id
        tag
        iso2
        iso3
        name
      }
      audioMandatory
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

const SET_MOVIE_SHORT_MUTATION = `
  mutation SetMovieShort($movieId: Int!, $isShort: Boolean!) {
    setMovieShort(movieId: $movieId, isShort: $isShort) {
      id
    }
  }
`;

// Same shape as setMovieAudioMandatoryAction in src/actions/languages.ts: a
// boolean flip cannot be invalid input, so the only failure paths are the
// unauthenticated redirect and the refusals of the GraphQL Contract Delta
// (shorts disabled, movies disabled, not owned) — a plain server function,
// not a useActionState form action.
export async function setMovieShortAction(
  movieId: string,
  isShort: boolean,
): Promise<{ error: string } | { success: true }> {
  let result: Awaited<ReturnType<typeof fetchGraphQL>>;
  try {
    result = await fetchGraphQL(SET_MOVIE_SHORT_MUTATION, {
      movieId: Number(movieId),
      isShort,
    });
  } catch (_err) {
    const t = await getTranslations("errors");
    return { error: t("network.connectionFailed") };
  }

  const { errors } = result;

  if (errors && errors.length > 0) {
    await redirectIfUnauthenticated(errors);
    return { error: await translateGraphQLError(errors[0]) };
  }

  return { success: true };
}
