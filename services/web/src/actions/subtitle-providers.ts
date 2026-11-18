"use server";

import { getTranslations } from "next-intl/server";
import {
  redirectIfUnauthenticated,
  redirectToClearSession,
} from "@/lib/auth-session";
import { fetchGraphQL } from "@/lib/graphql-client";
import { toActionError, translateGraphQLError } from "@/lib/graphql-error";
import type {
  SubtitleProviderActionResult,
  SubtitleProviderKind,
  SubtitleProviderLanguage,
  SubtitleProviderSettings,
} from "@/types/subtitle-providers";

const SETTINGS_SELECTION = `
  providers {
    kind
    configured
    isDefault
    username
    secretSet
    languageTags
  }
  languages {
    languageTag
    provider
  }
`;

const SUBTITLE_PROVIDERS_QUERY = `
  query SubtitleProviders {
    subtitleProviders {
      ${SETTINGS_SELECTION}
    }
  }
`;

const SAVE_SUBTITLE_PROVIDER_MUTATION = `
  mutation SaveSubtitleProvider($input: SubtitleProviderInput!) {
    saveSubtitleProvider(input: $input) {
      ${SETTINGS_SELECTION}
    }
  }
`;

const REMOVE_SUBTITLE_PROVIDER_MUTATION = `
  mutation RemoveSubtitleProvider($kind: SubtitleProviderKind!) {
    removeSubtitleProvider(kind: $kind) {
      ${SETTINGS_SELECTION}
    }
  }
`;

const SET_SUBTITLE_PROVIDER_LANGUAGES_MUTATION = `
  mutation SetSubtitleProviderLanguages($defaultProvider: SubtitleProviderKind!, $languages: [SubtitleProviderLanguageInput!]!) {
    setSubtitleProviderLanguages(defaultProvider: $defaultProvider, languages: $languages) {
      ${SETTINGS_SELECTION}
    }
  }
`;

// Spec 121, REQ-3
export async function getSubtitleProviders(): Promise<SubtitleProviderSettings> {
  const { data, errors } = await fetchGraphQL<{
    subtitleProviders: SubtitleProviderSettings;
  }>(SUBTITLE_PROVIDERS_QUERY);

  if (errors && errors.length > 0) {
    // Awaited during the settings page's render pass, where cookie mutation
    // is illegal, so hand off to the Route Handler.
    redirectToClearSession(errors);
    throw new Error(await translateGraphQLError(errors[0]));
  }

  return data?.subtitleProviders ?? { providers: [], languages: [] };
}

async function runMutation<K extends string>(
  document: string,
  field: K,
  variables: Record<string, unknown>,
): Promise<SubtitleProviderActionResult> {
  let result: Awaited<
    ReturnType<typeof fetchGraphQL<Record<K, SubtitleProviderSettings>>>
  >;

  try {
    result = await fetchGraphQL<Record<K, SubtitleProviderSettings>>(
      document,
      variables,
    );
  } catch (_err) {
    const t = await getTranslations("errors");
    return { error: t("network.connectionFailed") };
  }

  const { data, errors } = result;

  if (errors && errors.length > 0) {
    await redirectIfUnauthenticated(errors);
    return await toActionError(errors[0]);
  }

  if (!data?.[field]) {
    const t = await getTranslations("errors");
    return { error: t("network.connectionFailed") };
  }

  return { settings: data[field] };
}

// Spec 121, REQ-3 REQ-4
export async function saveSubtitleProviderAction(
  kind: SubtitleProviderKind,
  username: string | null,
  secret: string | null,
): Promise<SubtitleProviderActionResult> {
  return runMutation(SAVE_SUBTITLE_PROVIDER_MUTATION, "saveSubtitleProvider", {
    input: { kind, username, secret },
  });
}

// Spec 121, REQ-3
export async function removeSubtitleProviderAction(
  kind: SubtitleProviderKind,
): Promise<SubtitleProviderActionResult> {
  return runMutation(
    REMOVE_SUBTITLE_PROVIDER_MUTATION,
    "removeSubtitleProvider",
    { kind },
  );
}

// Spec 121, REQ-5 REQ-6
export async function setSubtitleProviderLanguagesAction(
  defaultProvider: SubtitleProviderKind,
  languages: SubtitleProviderLanguage[],
): Promise<SubtitleProviderActionResult> {
  return runMutation(
    SET_SUBTITLE_PROVIDER_LANGUAGES_MUTATION,
    "setSubtitleProviderLanguages",
    { defaultProvider, languages },
  );
}
