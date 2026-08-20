"use server";

import { getTranslations } from "next-intl/server";
import { redirectIfUnauthenticated } from "@/lib/auth-session";
import { fetchGraphQL } from "@/lib/graphql-client";
import { translateGraphQLError } from "@/lib/graphql-error";

const SET_UI_LOCALE_MUTATION = `
  mutation SetUiLocale($locale: String!) {
    setUiLocale(locale: $locale) {
      id
      uiLocale
    }
  }
`;

// Form-action shape (`prevState`, `FormData`) to match the rest of `src/actions/`
// and to be usable with `useActionState` from the locale picker this feature
// deliberately does not build yet (see `018-ui-i18n/spec.md` § Out of Scope).
export async function setUiLocaleAction(
  prevState: any,
  formData: FormData,
): Promise<{ error?: string } | { success: true }> {
  const locale = formData.get("locale");

  const t = await getTranslations("errors");

  if (typeof locale !== "string" || locale.trim() === "") {
    return { error: t("validation.missingLocale") };
  }

  let result: Awaited<ReturnType<typeof fetchGraphQL>>;
  try {
    result = await fetchGraphQL(SET_UI_LOCALE_MUTATION, { locale });
  } catch (err) {
    return { error: t("network.connectionFailed") };
  }

  const { errors } = result;

  if (errors && errors.length > 0) {
    await redirectIfUnauthenticated(errors);
    return { error: await translateGraphQLError(errors[0]) };
  }

  return { success: true };
}
