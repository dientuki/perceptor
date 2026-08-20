"use server";

import { redirectIfUnauthenticated } from "@/lib/auth-session";
import { fetchGraphQL } from "@/lib/graphql-client";
import { translateGraphQLError } from "@/lib/graphql-error";
import { MediaType } from "@/types/media";
import { MediaSearchResult } from "@/types/search";

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
