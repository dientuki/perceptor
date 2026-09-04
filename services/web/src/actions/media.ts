"use server";

import { cache } from "react";
import {
  redirectIfUnauthenticated,
  redirectToClearSession,
} from "@/lib/auth-session";
import { fetchGraphQL } from "@/lib/graphql-client";
import { translateGraphQLError } from "@/lib/graphql-error";
import type { MediaCapabilities, MediaType } from "@/types/media";
import type { MediaSearchResult } from "@/types/search";

const MEDIA_CAPABILITIES_QUERY = `
  query MediaCapabilities {
    mediaCapabilities {
      moviesEnabled
      showsEnabled
    }
  }
`;

// The actual round trip, cache()-wrapped so multiple components asking
// within the same request/render pass dedupe to a single GraphQL call
// (NFR-6), matching fetchMe()'s idiom in src/actions/auth.ts.
const fetchMediaCapabilities = cache(() =>
  fetchGraphQL<{ mediaCapabilities: MediaCapabilities }>(
    MEDIA_CAPABILITIES_QUERY,
  ),
);

// Read from the dashboard layout's Server Component render pass, where
// cookie mutation is illegal — an auth failure hands off to the Route
// Handler via redirectToClearSession, mirroring getCurrentUser()'s use of
// fetchMe() in src/actions/auth.ts, rather than redirectIfUnauthenticated
// (which mutates cookies and is only legal from a Server Action / Route
// Handler context).
//
// A failed read must never fall back to { moviesEnabled: false, showsEnabled:
// false } — that would render the product as uninstalled rather than as
// broken (NFR-4). Every failure throws a translated error instead.
export async function getMediaCapabilities(): Promise<MediaCapabilities> {
  const { data, errors } = await fetchMediaCapabilities();

  if (errors && errors.length > 0) {
    redirectToClearSession(errors);
    throw new Error(await translateGraphQLError(errors[0]));
  }

  if (!data?.mediaCapabilities) {
    throw new Error("El API no devolvió las capacidades de medios");
  }

  return data.mediaCapabilities;
}

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

// Render-safe sibling of searchMedia, for /search's Server Component render
// pass (which cannot call redirectIfUnauthenticated — that mutates cookies,
// legal only from a Server Action / Route Handler). Reuses SEARCH_MEDIA_QUERY
// and copies searchAllMedia's redirectToClearSession auth-failure handling
// verbatim (web/plan.md step 6).
export async function searchMediaForPage(
  query: string,
  type: MediaType,
): Promise<MediaSearchResult[]> {
  // El API ya corta con [] en query vacía, pero evitamos el round trip
  if (!query.trim()) return [];

  const { data, errors } = await fetchGraphQL<{
    searchMedia: MediaSearchResult[];
  }>(SEARCH_MEDIA_QUERY, { query, type });

  if (errors && errors.length > 0) {
    redirectToClearSession(errors);
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

const POPULAR_MEDIA_QUERY = `
  query PopularMedia($type: String!) {
    popularMedia(type: $type) {
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

// Awaited during the billboard's Server Component render pass — cookie
// mutation is illegal there, so an auth failure hands off to the Route
// Handler via redirectToClearSession instead of redirectIfUnauthenticated
// (which mutates cookies and is only legal from a Server Action / Route
// Handler context).
export async function getPopularMedia(
  type: MediaType,
): Promise<MediaSearchResult[]> {
  const { data, errors } = await fetchGraphQL<{
    popularMedia: MediaSearchResult[];
  }>(POPULAR_MEDIA_QUERY, { type });

  if (errors && errors.length > 0) {
    redirectToClearSession(errors);
    throw new Error(await translateGraphQLError(errors[0]));
  }

  return data?.popularMedia ?? [];
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
