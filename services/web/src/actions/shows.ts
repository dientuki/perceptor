"use server";

import { redirectToClearSession } from "@/lib/auth-session";
import { fetchGraphQL } from "@/lib/graphql-client";

export interface Show {
  id: string;
  tmdbId: number;
  title: string;
  overview?: string;
  posterUrl?: string;
  releaseDate?: string;
  originalLanguage: string;
  isLiveAction: boolean;
  status: string;
  seasonsSyncedAt?: string;
}

const GET_SHOWS_QUERY = `
  query GetStoredShows {
    shows {
      id
      overview
      title
      posterUrl
      releaseDate
    }
  }
`;

export async function getShows(): Promise<Show[]> {
  const { data, errors } = await fetchGraphQL<{ shows: Show[] }>(
    GET_SHOWS_QUERY,
  );

  // GraphQL answers 200 with `errors` populated: without this check `data` is undefined
  if (errors && errors.length > 0) {
    // Called directly from ShowsPage's Server Component render — cookie
    // mutation is illegal there, so hand off to the Route Handler instead of
    // redirectIfUnauthenticated (which throws by mutating cookies).
    redirectToClearSession(errors);
    // Any other error: log it server-side and fall back to an empty list,
    // matching what the client component's try/catch used to do silently —
    // there is no app/(dashboard)/error.tsx, so letting this throw would
    // surface Next's default error screen instead of the empty state.
    console.error("Error al obtener series:", errors[0]?.message);
    return [];
  }

  return data?.shows ?? [];
}
