"use server";

import { redirectIfUnauthenticated } from "@/lib/auth-session";
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
    await redirectIfUnauthenticated(errors);
    throw new Error(errors[0]?.message || "Error al obtener series");
  }

  return data?.shows ?? [];
}
