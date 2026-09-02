"use server";

import { getTranslations } from "next-intl/server";
import {
  redirectIfUnauthenticated,
  redirectToClearSession,
} from "@/lib/auth-session";
import { fetchGraphQL } from "@/lib/graphql-client";
import { translateGraphQLError } from "@/lib/graphql-error";
import type {
  LanguageTrackKind,
  TorrentGroup,
  TorrentGroupScope,
  UserPreferences,
} from "@/types/preferences";

const PREFERENCES_QUERY = `
  query Preferences {
    preferences {
      allowCinemaReleases
      audioMandatory
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
      torrentGroups {
        id
        name
        scope
      }
    }
  }
`;

export async function getPreferences(): Promise<UserPreferences> {
  const { data, errors } = await fetchGraphQL<{
    preferences: UserPreferences;
  }>(PREFERENCES_QUERY);

  if (errors && errors.length > 0) {
    // Awaited during a Server Component's render pass — cookie mutation is
    // illegal there, so hand off to the Route Handler instead.
    redirectToClearSession(errors);
    throw new Error(await translateGraphQLError(errors[0]));
  }

  return (
    data?.preferences ?? {
      allowCinemaReleases: false,
      audioMandatory: false,
      audioLanguages: [],
      subtitleLanguages: [],
      torrentGroups: [],
    }
  );
}

const TORRENT_GROUPS_QUERY = `
  query TorrentGroups {
    torrentGroups {
      id
      name
      scope
    }
  }
`;

// Called without `scope` — the whole catalog comes back and callers split it
// by `group.scope` themselves (spec § "Query.torrentGroups is the catalog").
export async function getTorrentGroups(): Promise<TorrentGroup[]> {
  const { data, errors } = await fetchGraphQL<{
    torrentGroups: TorrentGroup[];
  }>(TORRENT_GROUPS_QUERY);

  if (errors && errors.length > 0) {
    redirectToClearSession(errors);
    throw new Error(await translateGraphQLError(errors[0]));
  }

  return data?.torrentGroups ?? [];
}

const SET_ALLOW_CINEMA_RELEASES_MUTATION = `
  mutation SetAllowCinemaReleases($allowed: Boolean!) {
    setAllowCinemaReleases(allowed: $allowed) {
      allowCinemaReleases
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
      torrentGroups {
        id
        name
        scope
      }
    }
  }
`;

// A boolean cannot be invalid (spec § "setAllowCinemaReleases has no failure
// of its own") — the unauthenticated redirect is its only failure path, so
// this is a plain server function called from a click handler, not a
// useActionState form action.
export async function setAllowCinemaReleasesAction(
  allowed: boolean,
): Promise<
  { error: string } | { success: true; preferences: UserPreferences }
> {
  let result: Awaited<ReturnType<typeof fetchGraphQL>>;
  try {
    result = await fetchGraphQL(SET_ALLOW_CINEMA_RELEASES_MUTATION, {
      allowed,
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

  return {
    success: true,
    preferences: (result.data as { setAllowCinemaReleases: UserPreferences })
      .setAllowCinemaReleases,
  };
}

const SET_AUDIO_MANDATORY_MUTATION = `
  mutation SetAudioMandatory($mandatory: Boolean!) {
    setAudioMandatory(mandatory: $mandatory) {
      allowCinemaReleases
      audioMandatory
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
      torrentGroups {
        id
        name
        scope
      }
    }
  }
`;

// A boolean cannot be invalid, same as setAllowCinemaReleasesAction above —
// the unauthenticated redirect is its only failure path.
export async function setAudioMandatoryAction(
  mandatory: boolean,
): Promise<
  { error: string } | { success: true; preferences: UserPreferences }
> {
  let result: Awaited<ReturnType<typeof fetchGraphQL>>;
  try {
    result = await fetchGraphQL(SET_AUDIO_MANDATORY_MUTATION, {
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

  return {
    success: true,
    preferences: (result.data as { setAudioMandatory: UserPreferences })
      .setAudioMandatory,
  };
}

const SET_PREFERRED_TRACK_LANGUAGES_MUTATION = `
  mutation SetPreferredTrackLanguages($kind: LanguageTrackKind!, $tags: [String!]!) {
    setPreferredTrackLanguages(kind: $kind, tags: $tags) {
      id
      tag
      iso2
      iso3
      name
    }
  }
`;

// Bound per call site to a kind, the way setMoviePreferredLanguagesAction is
// bound to a movie id — the card passes the bound function to
// LanguagePicker's `action` prop, which supplies (prevState, formData).
export async function setPreferredTrackLanguagesAction(
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
    result = await fetchGraphQL(SET_PREFERRED_TRACK_LANGUAGES_MUTATION, {
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

const SET_PREFERRED_TORRENT_GROUPS_MUTATION = `
  mutation SetPreferredTorrentGroups($scope: TorrentGroupScope!, $ids: [Int!]!) {
    setPreferredTorrentGroups(scope: $scope, ids: $ids) {
      id
      name
      scope
    }
  }
`;

// Bound per call site to a scope, mirroring
// setPreferredTrackLanguagesAction above. Ids arrive from the form as
// strings and are converted with Number before they go on the wire — [Int!]!
// rejects strings at runtime with no compile error here.
export async function setPreferredTorrentGroupsAction(
  scope: TorrentGroupScope,
  _prevState: unknown,
  formData: FormData,
): Promise<{ error?: string } | { success: true }> {
  const ids = String(formData.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((id) => Number(id));

  let result: Awaited<ReturnType<typeof fetchGraphQL>>;
  try {
    result = await fetchGraphQL(SET_PREFERRED_TORRENT_GROUPS_MUTATION, {
      scope,
      ids,
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
