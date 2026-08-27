"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { redirectIfUnauthenticated } from "@/lib/auth-session";
import { fetchGraphQL } from "@/lib/graphql-client";
import { translateGraphQLError } from "@/lib/graphql-error";
import type { AdminUser } from "@/types/users";

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

export interface CreateUserInput {
  name: string;
  username: string;
  password: string;
  passwordConfirmation: string;
}

export async function createUserAction(
  input: CreateUserInput,
): Promise<{ error?: string } | { success: true }> {
  const { name, username, password, passwordConfirmation } = input;

  const t = await getTranslations("errors");

  if (password !== passwordConfirmation) {
    return { error: t("validation.passwordMismatch") };
  }

  let result: Awaited<ReturnType<typeof fetchGraphQL>>;
  try {
    result = await fetchGraphQL(CREATE_USER_MUTATION, {
      createUserInput: { name, username, password },
    });
  } catch (_err) {
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
      name
      username
      isEnabled
    }
  }
`;

export interface UpdateUserInput {
  id: string;
  name: string;
  username: string;
}

export async function updateUserAction(
  input: UpdateUserInput,
): Promise<{ error?: string } | { success: true }> {
  const { id, name, username } = input;

  let result: Awaited<ReturnType<typeof fetchGraphQL>>;
  try {
    result = await fetchGraphQL(UPDATE_USER_MUTATION, {
      // Only { id, name, username } — built field by field rather than
      // spreading the input object, and never `password`/`isEnabled`/
      // `isAdmin`: an empty-string password would be hashed and silently
      // lock the user out, with no error anywhere.
      updateUserInput: { id, name, username },
    });
  } catch (_err) {
    const t = await getTranslations("errors");
    return { error: t("network.connectionFailed") };
  }

  const { errors } = result;

  if (errors && errors.length > 0) {
    await redirectIfUnauthenticated(errors);
    // Translated via the API's `extensions.i18n.key` — this is what surfaces
    // REQ-9's username-taken message and the UpdateUserInput validation
    // messages in the active locale, falling back to the English message if
    // the catalog hasn't caught up with the key yet.
    return { error: await translateGraphQLError(errors[0]) };
  }

  revalidatePath("/users");
  return { success: true };
}

export async function setUserEnabledAction(
  id: string,
  isEnabled: boolean,
): Promise<{ error?: string } | { success: true }> {
  let result: Awaited<ReturnType<typeof fetchGraphQL>>;
  try {
    result = await fetchGraphQL(UPDATE_USER_MUTATION, {
      // Only { id, isEnabled } — UpdateUserInput is partial, and sending
      // name/username here would let a status toggle silently rewrite fields
      // nobody edited.
      updateUserInput: { id, isEnabled },
    });
  } catch (_err) {
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
  id: string,
): Promise<{ error?: string } | { success: true }> {
  let result: Awaited<ReturnType<typeof fetchGraphQL>>;
  try {
    result = await fetchGraphQL(REMOVE_USER_MUTATION, { id });
  } catch (_err) {
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
