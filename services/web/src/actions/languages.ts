"use server";

import { getTranslations } from "next-intl/server";
import {
  redirectIfUnauthenticated,
  redirectToClearSession,
} from "@/lib/auth-session";
import { fetchGraphQL } from "@/lib/graphql-client";
import { translateGraphQLError } from "@/lib/graphql-error";
import type { Language } from "@/types/languages";

const LANGUAGES_QUERY = `
  query Languages {
    languages {
      id
      iso2
      iso3
      name
    }
  }
`;

export async function getLanguages(): Promise<Language[]> {
  const { data, errors } = await fetchGraphQL<{ languages: Language[] }>(
    LANGUAGES_QUERY,
  );

  if (errors && errors.length > 0) {
    // Called directly from a Server Component's render (settings/movie/show
    // pages) — cookie mutation is illegal there, so hand off to the Route
    // Handler instead.
    redirectToClearSession(errors);
    throw new Error(await translateGraphQLError(errors[0]));
  }

  return data?.languages ?? [];
}

const SET_PREFERRED_LANGUAGES_MUTATION = `
  mutation SetPreferredLanguages($iso2: [String!]!) {
    setPreferredLanguages(iso2: $iso2) {
      id
      iso2
      iso3
      name
    }
  }
`;

export async function setPreferredLanguagesAction(
  _prevState: unknown,
  formData: FormData,
): Promise<{ error?: string } | { success: true }> {
  const iso2 = formData.getAll("iso2").map(String);

  let result: Awaited<ReturnType<typeof fetchGraphQL>>;
  try {
    result = await fetchGraphQL(SET_PREFERRED_LANGUAGES_MUTATION, { iso2 });
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

const SET_MOVIE_PREFERRED_LANGUAGES_MUTATION = `
  mutation SetMoviePreferredLanguages($movieId: Int!, $iso2: [String!]!) {
    setMoviePreferredLanguages(movieId: $movieId, iso2: $iso2) {
      id
      iso2
      iso3
      name
    }
  }
`;

export async function setMoviePreferredLanguagesAction(
  movieId: string,
  _prevState: unknown,
  formData: FormData,
): Promise<{ error?: string } | { success: true }> {
  const iso2 = formData.getAll("iso2").map(String);

  let result: Awaited<ReturnType<typeof fetchGraphQL>>;
  try {
    result = await fetchGraphQL(SET_MOVIE_PREFERRED_LANGUAGES_MUTATION, {
      movieId: Number(movieId),
      iso2,
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

const SET_SHOW_PREFERRED_LANGUAGES_MUTATION = `
  mutation SetShowPreferredLanguages($showId: Int!, $iso2: [String!]!) {
    setShowPreferredLanguages(showId: $showId, iso2: $iso2) {
      id
      iso2
      iso3
      name
    }
  }
`;

export async function setShowPreferredLanguagesAction(
  showId: string,
  _prevState: unknown,
  formData: FormData,
): Promise<{ error?: string } | { success: true }> {
  const iso2 = formData.getAll("iso2").map(String);

  let result: Awaited<ReturnType<typeof fetchGraphQL>>;
  try {
    result = await fetchGraphQL(SET_SHOW_PREFERRED_LANGUAGES_MUTATION, {
      showId: Number(showId),
      iso2,
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
