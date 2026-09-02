"use server";

import { getTranslations } from "next-intl/server";
import {
  redirectIfUnauthenticated,
  redirectToClearSession,
} from "@/lib/auth-session";
import { fetchGraphQL } from "@/lib/graphql-client";
import { translateGraphQLError } from "@/lib/graphql-error";
import type { Language } from "@/types/languages";
import type { LanguageTrackKind } from "@/types/preferences";

const LANGUAGES_QUERY = `
  query Languages {
    languages {
      id
      tag
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

const SET_MOVIE_PREFERRED_TRACK_LANGUAGES_MUTATION = `
  mutation SetMoviePreferredTrackLanguages($movieId: Int!, $kind: LanguageTrackKind!, $tags: [String!]!) {
    setMoviePreferredTrackLanguages(movieId: $movieId, kind: $kind, tags: $tags) {
      id
      tag
      iso2
      iso3
      name
    }
  }
`;

// Bound per call site to a movie id and a kind, the way
// setPreferredTrackLanguagesAction is bound to a kind alone — see
// src/actions/preferences.ts.
export async function setMoviePreferredTrackLanguagesAction(
  movieId: string,
  kind: LanguageTrackKind,
  _prevState: unknown,
  formData: FormData,
): Promise<{ error?: string } | { success: true }> {
  const tags = String(formData.get("tags") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  let result: Awaited<ReturnType<typeof fetchGraphQL>>;
  try {
    result = await fetchGraphQL(SET_MOVIE_PREFERRED_TRACK_LANGUAGES_MUTATION, {
      movieId: Number(movieId),
      kind,
      tags,
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

const SET_MOVIE_AUDIO_MANDATORY_MUTATION = `
  mutation SetMovieAudioMandatory($movieId: Int!, $mandatory: Boolean!) {
    setMovieAudioMandatory(movieId: $movieId, mandatory: $mandatory)
  }
`;

// A boolean cannot be invalid — the only failure paths are the
// unauthenticated redirect and the same ownership refusal every per-title
// mutation carries, so this is a plain server function, not a
// useActionState form action, same shape as setAllowCinemaReleasesAction in
// src/actions/preferences.ts.
export async function setMovieAudioMandatoryAction(
  movieId: string,
  mandatory: boolean,
): Promise<{ error: string } | { success: true }> {
  let result: Awaited<ReturnType<typeof fetchGraphQL>>;
  try {
    result = await fetchGraphQL(SET_MOVIE_AUDIO_MANDATORY_MUTATION, {
      movieId: Number(movieId),
      mandatory,
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

const SET_SHOW_PREFERRED_TRACK_LANGUAGES_MUTATION = `
  mutation SetShowPreferredTrackLanguages($showId: Int!, $kind: LanguageTrackKind!, $tags: [String!]!) {
    setShowPreferredTrackLanguages(showId: $showId, kind: $kind, tags: $tags) {
      id
      tag
      iso2
      iso3
      name
    }
  }
`;

export async function setShowPreferredTrackLanguagesAction(
  showId: string,
  kind: LanguageTrackKind,
  _prevState: unknown,
  formData: FormData,
): Promise<{ error?: string } | { success: true }> {
  const tags = String(formData.get("tags") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  let result: Awaited<ReturnType<typeof fetchGraphQL>>;
  try {
    result = await fetchGraphQL(SET_SHOW_PREFERRED_TRACK_LANGUAGES_MUTATION, {
      showId: Number(showId),
      kind,
      tags,
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

const SET_SHOW_AUDIO_MANDATORY_MUTATION = `
  mutation SetShowAudioMandatory($showId: Int!, $mandatory: Boolean!) {
    setShowAudioMandatory(showId: $showId, mandatory: $mandatory)
  }
`;

// Twin of setMovieAudioMandatoryAction above, for a series.
export async function setShowAudioMandatoryAction(
  showId: string,
  mandatory: boolean,
): Promise<{ error: string } | { success: true }> {
  let result: Awaited<ReturnType<typeof fetchGraphQL>>;
  try {
    result = await fetchGraphQL(SET_SHOW_AUDIO_MANDATORY_MUTATION, {
      showId: Number(showId),
      mandatory,
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
