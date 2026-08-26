"use server";

import { getTranslations } from "next-intl/server";
import { redirectIfUnauthenticated } from "@/lib/auth-session";
import { fetchGraphQL } from "@/lib/graphql-client";
import { translateGraphQLError } from "@/lib/graphql-error";

const UPDATE_PROFILE_MUTATION = `
  mutation UpdateProfile($updateProfileInput: UpdateProfileInput!) {
    updateProfile(updateProfileInput: $updateProfileInput) {
      id
      name
      username
    }
  }
`;

export interface UpdateProfileInput {
  name: string;
  username: string;
  password?: string;
  passwordConfirmation?: string;
}

export async function updateProfileAction(
  input: UpdateProfileInput,
): Promise<{ error?: string } | { success: true }> {
  const { name, username, password, passwordConfirmation } = input;
  const t = await getTranslations("errors");

  const hasPassword = Boolean(password);
  const hasConfirmation = Boolean(passwordConfirmation);

  // REQ-4: exactly one of the two filled is refused before any network call —
  // these two strings are web-local and never come from `api`.
  if (hasPassword !== hasConfirmation) {
    return { error: t("validation.passwordPairIncomplete") };
  }

  if (hasPassword && password !== passwordConfirmation) {
    return { error: t("validation.passwordMismatch") };
  }

  let result: Awaited<ReturnType<typeof fetchGraphQL>>;
  try {
    result = await fetchGraphQL(UPDATE_PROFILE_MUTATION, {
      // `password` is omitted entirely when unset — never sent as `""`
      // (docs/spec/features/020-profile-edit/plan.md § Contract Freeze).
      updateProfileInput: {
        name,
        username,
        ...(hasPassword ? { password } : {}),
      },
    });
  } catch (_err) {
    return { error: t("network.connectionFailed") };
  }

  const { errors } = result;

  if (errors && errors.length > 0) {
    await redirectIfUnauthenticated(errors);
    // Translated via the API's `extensions.i18n.key`, falling back to the
    // English message if the catalog hasn't caught up with the key yet.
    return { error: await translateGraphQLError(errors[0]) };
  }

  return { success: true };
}
