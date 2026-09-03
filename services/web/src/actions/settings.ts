"use server";

import { getTranslations } from "next-intl/server";
import {
  redirectIfUnauthenticated,
  redirectToClearSession,
} from "@/lib/auth-session";
import { fetchGraphQL } from "@/lib/graphql-client";
import { translateGraphQLError } from "@/lib/graphql-error";
import { Setting } from "@/types/settings";

const SETTINGS_QUERY = `
  query Settings {
    settings {
      key
      value
    }
  }
`;

export async function getSettings(): Promise<Setting[]> {
  const { data, errors } = await fetchGraphQL<{ settings: Setting[] }>(
    SETTINGS_QUERY,
  );

  if (errors && errors.length > 0) {
    // Called directly from SettingsPage's Server Component render — cookie
    // mutation is illegal there, so hand off to the Route Handler instead of
    // redirectIfUnauthenticated (used below, in the form action, where it's legal).
    redirectToClearSession(errors);
    throw new Error(await translateGraphQLError(errors[0]));
  }

  return data?.settings ?? [];
}

const DEFAULT_UI_LOCALE_QUERY = `
  query DefaultUiLocale {
    defaultUiLocale
  }
`;

// Public on the api side (`@Public()`) — read while resolving the locale for
// an anonymous request such as /login. Still goes through
// redirectToClearSession rather than swallowing errors, because it is
// awaited during a Server Component render pass (src/i18n/request.ts) where
// cookie mutation is illegal.
export async function getDefaultUiLocale(): Promise<string | null> {
  const { data, errors } = await fetchGraphQL<{
    defaultUiLocale: string | null;
  }>(DEFAULT_UI_LOCALE_QUERY);

  if (errors && errors.length > 0) {
    redirectToClearSession(errors);
    throw new Error(await translateGraphQLError(errors[0]));
  }

  return data?.defaultUiLocale ?? null;
}

const UPDATE_SETTINGS_MUTATION = `
  mutation UpdateSettings($entries: [SettingInput!]!) {
    updateSettings(entries: $entries) {
      key
      value
    }
  }
`;

// Las claves que este form conoce y puede guardar. El resto de los settings
// (torrent_client, torrent_host, torrent_port, ia_*, movie_db_client,
// movie_db_host) no se editan acá — torrent_port en particular no tiene sentido editarlo:
// es el puerto interno de qBittorrent dentro de la red de Docker (QBITTORRENT_WEBUI_PORT
// en .env), no algo que el usuario final deba tocar.
const EDITABLE_KEYS = [
  "path_downloads",
  "tracker_api_key",
  "movie_db_api_key",
  "path_movies",
  "path_shows",
  "media_server_client",
  "media_server_host",
  "media_server_port",
  "media_server_api_key",
  "ui_locale",
] as const;

// Rendered through Checkbox.tsx + a hidden input carrying an explicit
// 'true'/'false' (the PathPicker hidden-input idiom — Checkbox.tsx is
// controlled and renders no `name`d input of its own). Read explicitly
// rather than through EDITABLE_KEYS's blank-value filter, and by the hidden
// input's *value*, not `formData.has(key)` — the hidden input is always
// present, so presence alone can no longer distinguish checked from
// unchecked the way a native unchecked checkbox (absent from FormData) did.
const BOOLEAN_KEYS = [
  "movies_enabled",
  "shows_enabled",
  "compression_enabled",
  "schedule_refresh_movies_enabled",
  "schedule_refresh_shows_enabled",
  "schedule_refresh_episodes_enabled",
  "schedule_acquire_pending_enabled",
] as const;

export async function updateSettingsAction(
  prevState: any,
  formData: FormData,
): Promise<{ error?: string } | { success: true }> {
  const entries: { key: string; value: string }[] = EDITABLE_KEYS.map(
    (key) => ({ key, value: formData.get(key) }),
  ).filter(
    (entry): entry is { key: (typeof EDITABLE_KEYS)[number]; value: string } =>
      typeof entry.value === "string" && entry.value.trim() !== "",
  );

  for (const key of BOOLEAN_KEYS) {
    entries.push({
      key,
      value: formData.get(key) === "true" ? "true" : "false",
    });
  }

  const t = await getTranslations("errors");

  if (entries.length === 0) {
    return { error: t("validation.missingSettingsValues") };
  }

  let result: Awaited<ReturnType<typeof fetchGraphQL>>;
  try {
    result = await fetchGraphQL(UPDATE_SETTINGS_MUTATION, { entries });
  } catch (_err) {
    return { error: t("network.connectionFailed") };
  }

  const { errors } = result;

  if (errors && errors.length > 0) {
    await redirectIfUnauthenticated(errors);
    return { error: await translateGraphQLError(errors[0]) };
  }

  return { success: true };
}
