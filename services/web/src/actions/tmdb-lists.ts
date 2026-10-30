"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import {
  redirectIfUnauthenticated,
  redirectToClearSession,
} from "@/lib/auth-session";
import { fetchGraphQL } from "@/lib/graphql-client";
import { toActionError, translateGraphQLError } from "@/lib/graphql-error";
import type { TmdbList, TmdbListDetail } from "@/types/preferences";

const TMDB_LISTS_QUERY = `
  query TmdbLists {
    tmdbLists {
      id
      tmdbListId
      name
      itemCount
      lastImportedAt
      lastError
    }
  }
`;

const TMDB_LIST_QUERY = `
  query TmdbList($id: Int!) {
    tmdbList(id: $id) {
      id
      tmdbListId
      name
      itemCount
      lastImportedAt
      lastError
      movies {
        id
        status
        title
        overview
        posterUrl
        releaseDate
        isShort
      }
      shows {
        id
        status
        title
        overview
        posterUrl
        releaseDate
      }
    }
  }
`;

const ADD_TMDB_LIST_MUTATION = `
  mutation AddTmdbList($reference: String!) {
    addTmdbList(reference: $reference) {
      id
      tmdbListId
      name
      itemCount
      lastImportedAt
      lastError
    }
  }
`;

const REMOVE_TMDB_LIST_MUTATION = `
  mutation RemoveTmdbList($id: Int!) {
    removeTmdbList(id: $id)
  }
`;

// Spec 109, REQ-13
export async function getTmdbLists(): Promise<TmdbList[]> {
  const { data, errors } = await fetchGraphQL<{ tmdbLists: TmdbList[] }>(
    TMDB_LISTS_QUERY,
  );

  if (errors && errors.length > 0) {
    redirectToClearSession(errors);
    throw new Error(await translateGraphQLError(errors[0]));
  }

  return data?.tmdbLists ?? [];
}

// Spec 109, REQ-14
export async function getTmdbList(id: number): Promise<TmdbListDetail | null> {
  const { data, errors } = await fetchGraphQL<{
    tmdbList: TmdbListDetail | null;
  }>(TMDB_LIST_QUERY, { id });

  if (errors && errors.length > 0) {
    redirectToClearSession(errors);
    throw new Error(await translateGraphQLError(errors[0]));
  }

  return data?.tmdbList ?? null;
}

// Spec 109, REQ-13
export async function addTmdbListAction(
  reference: string,
): Promise<{ ok: boolean; error?: string }> {
  let result: Awaited<
    ReturnType<typeof fetchGraphQL<{ addTmdbList: TmdbList }>>
  >;
  try {
    result = await fetchGraphQL<{ addTmdbList: TmdbList }>(
      ADD_TMDB_LIST_MUTATION,
      { reference },
    );
  } catch (_err) {
    const t = await getTranslations("errors");
    return { ok: false, error: t("network.connectionFailed") };
  }

  const { errors } = result;

  if (errors && errors.length > 0) {
    await redirectIfUnauthenticated(errors);
    return { ok: false, error: await translateGraphQLError(errors[0]) };
  }

  revalidatePath("/lists");
  return { ok: true };
}

// Spec 109, REQ-13
export async function removeTmdbListAction(
  id: number,
): Promise<{ ok: boolean; error?: string; errorKey?: string }> {
  let result: Awaited<
    ReturnType<typeof fetchGraphQL<{ removeTmdbList: boolean }>>
  >;
  try {
    result = await fetchGraphQL<{ removeTmdbList: boolean }>(
      REMOVE_TMDB_LIST_MUTATION,
      { id },
    );
  } catch (_err) {
    const t = await getTranslations("errors");
    return { ok: false, error: t("network.connectionFailed") };
  }

  const { errors } = result;

  if (errors && errors.length > 0) {
    await redirectIfUnauthenticated(errors);
    return { ok: false, ...(await toActionError(errors[0])) };
  }

  revalidatePath("/lists");
  return { ok: true };
}
