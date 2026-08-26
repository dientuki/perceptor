"use server";

import {
  redirectIfUnauthenticated,
  redirectToClearSession,
} from "@/lib/auth-session";
import { fetchGraphQL } from "@/lib/graphql-client";
import { translateGraphQLError } from "@/lib/graphql-error";
import type { MediaType } from "@/types/media";
import type { MediaSearchResult } from "@/types/search";

const SEARCH_MEDIA_QUERY = `
  query SearchMedia($query: String!, $type: String!) {
    searchMedia(query: $query, type: $type) {
      id
      title
      releaseDate
      posterUrl
      originalLanguage
      overview
      type
      mediaId
      inLibrary
    }
  }
`;

export async function searchMedia(
  query: string,
  type: MediaType,
): Promise<MediaSearchResult[]> {
  // El API ya corta con [] en query vacía, pero evitamos el round trip
  if (!query.trim()) return [];

  const { data, errors } = await fetchGraphQL<{
    searchMedia: MediaSearchResult[];
  }>(SEARCH_MEDIA_QUERY, { query, type });

  if (errors && errors.length > 0) {
    await redirectIfUnauthenticated(errors);
    throw new Error(await translateGraphQLError(errors[0]));
  }

  return data?.searchMedia ?? [];
}

const SEARCH_ALL_MEDIA_QUERY = `
  query SearchAllMedia($query: String!) {
    searchAllMedia(query: $query) {
      id
      title
      releaseDate
      posterUrl
      originalLanguage
      overview
      type
      mediaId
      inLibrary
    }
  }
`;

// Called directly from the /search page's Server Component render — cookie
// mutation is illegal there, so an auth failure hands off to the Route
// Handler via redirectToClearSession instead of redirectIfUnauthenticated
// (which mutates cookies and is only legal from a Server Action / Route
// Handler context).
export async function searchAllMedia(
  query: string,
): Promise<MediaSearchResult[]> {
  // El API ya corta con [] en query vacía, pero evitamos el round trip
  if (!query.trim()) return [];

  const { data, errors } = await fetchGraphQL<{
    searchAllMedia: MediaSearchResult[];
  }>(SEARCH_ALL_MEDIA_QUERY, { query });

  if (errors && errors.length > 0) {
    redirectToClearSession(errors);
    throw new Error(await translateGraphQLError(errors[0]));
  }

  return data?.searchAllMedia ?? [];
}

const ADD_MEDIA_MUTATION = `
  mutation AddMedia($tmdbId: Int!, $type: String!) {
    addMedia(tmdbId: $tmdbId, type: $type) {
      id
      type
    }
  }
`;

export async function addMedia(
  tmdbId: number,
  type: MediaType,
): Promise<string> {
  const { data, errors } = await fetchGraphQL<{
    addMedia: { id: number; type: string };
  }>(ADD_MEDIA_MUTATION, { tmdbId, type });

  if (errors && errors.length > 0) {
    await redirectIfUnauthenticated(errors);
    throw new Error(await translateGraphQLError(errors[0]));
  }

  const id = data?.addMedia?.id;
  if (id === undefined || id === null)
    throw new Error("El API no devolvió el id del medio");

  return String(id);
}
