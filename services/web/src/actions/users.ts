"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { redirectIfUnauthenticated } from "@/lib/auth-session";
import { fetchGraphQL } from "@/lib/graphql-client";
import { translateGraphQLError } from "@/lib/graphql-error";
import { AdminUser } from "@/types/users";

const USERS_QUERY = `
  query Users {
    users {
      id
      name
      username
      isAdmin
      isEnabled
    }
  }
`;

export async function getUsers(): Promise<AdminUser[]> {
  const { data, errors } = await fetchGraphQL<{ users: AdminUser[] }>(
    USERS_QUERY,
  );

  if (errors && errors.length > 0) {
    await redirectIfUnauthenticated(errors);
    throw new Error(await translateGraphQLError(errors[0]));
  }

  return data?.users ?? [];
}

const CREATE_USER_MUTATION = `
  mutation CreateUser($createUserInput: CreateUserInput!) {
    createUser(createUserInput: $createUserInput) {
      id
      name
      username
      isAdmin
    }
  }
`;

export async function createUserAction(
  prevState: any,
  formData: FormData,
): Promise<{ error?: string } | { success: true }> {
  const name = formData.get("name");
  const username = formData.get("username");
  const password = formData.get("password");
  const passwordConfirmation = formData.get("passwordConfirmation");

  const t = await getTranslations("errors");

  if (password !== passwordConfirmation) {
    return { error: t("validation.passwordMismatch") };
  }

  let result: Awaited<ReturnType<typeof fetchGraphQL>>;
  try {
    result = await fetchGraphQL(CREATE_USER_MUTATION, {
      createUserInput: { name, username, password },
    });
  } catch (err) {
    return { error: t("network.connectionFailed") };
  }

  const { errors } = result;

  if (errors && errors.length > 0) {
    await redirectIfUnauthenticated(errors);
    // Translated via the API's `extensions.i18n.key` — this is what surfaces
    // REQ-6's duplicate-username message and the CreateUserInput validation
    // messages in the active locale, falling back to the English message if
    // the catalog hasn't caught up with the key yet.
    return { error: await translateGraphQLError(errors[0]) };
  }

  revalidatePath("/users");
  return { success: true };
}

const UPDATE_USER_MUTATION = `
  mutation UpdateUser($updateUserInput: UpdateUserInput!) {
    updateUser(updateUserInput: $updateUserInput) {
      id
      isEnabled
    }
  }
`;

export async function setUserEnabledAction(
  prevState: any,
  formData: FormData,
): Promise<{ error?: string } | { success: true }> {
  const id = formData.get("id");
  // formData values are strings — a raw truthy check would make "false" truthy
  // and turn every disable into a silent enable.
  const isEnabled = formData.get("isEnabled") === "true";

  let result: Awaited<ReturnType<typeof fetchGraphQL>>;
  try {
    result = await fetchGraphQL(UPDATE_USER_MUTATION, {
      // Only { id, isEnabled } — UpdateUserInput is partial, and sending
      // name/username here would let a status toggle silently rewrite fields
      // nobody edited.
      updateUserInput: { id, isEnabled },
    });
  } catch (err) {
    const t = await getTranslations("errors");
    return { error: t("network.connectionFailed") };
  }

  const { errors } = result;

  if (errors && errors.length > 0) {
    await redirectIfUnauthenticated(errors);
    // Translated via the API's `extensions.i18n.key` — this is what surfaces
    // REQ-5's self-disable and last-admin messages in the active locale,
    // falling back to the English message if the catalog hasn't caught up
    // with the key yet.
    return { error: await translateGraphQLError(errors[0]) };
  }

  revalidatePath("/users");
  return { success: true };
}

const REMOVE_USER_MUTATION = `
  mutation RemoveUser($id: ID!) {
    removeUser(id: $id) {
      id
    }
  }
`;

export async function deleteUserAction(
  prevState: any,
  formData: FormData,
): Promise<{ error?: string } | { success: true }> {
  const id = formData.get("id");

  let result: Awaited<ReturnType<typeof fetchGraphQL>>;
  try {
    result = await fetchGraphQL(REMOVE_USER_MUTATION, { id });
  } catch (err) {
    const t = await getTranslations("errors");
    return { error: t("network.connectionFailed") };
  }

  const { errors } = result;

  if (errors && errors.length > 0) {
    await redirectIfUnauthenticated(errors);
    // Translated via the API's `extensions.i18n.key` — this is what surfaces
    // REQ-5's self-delete and last-admin messages (AC-7, AC-8) in the active
    // locale, falling back to the English message if the catalog hasn't
    // caught up with the key yet.
    return { error: await translateGraphQLError(errors[0]) };
  }

  revalidatePath("/users");
  return { success: true };
}
