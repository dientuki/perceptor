'use server'

import { revalidatePath } from 'next/cache';
import { fetchGraphQL } from '@/lib/graphql-client';
import { redirectIfUnauthenticated } from '@/lib/auth-session';
import { AdminUser } from '@/types/users';

const USERS_QUERY = `
  query Users {
    users {
      id
      name
      username
      isAdmin
    }
  }
`;

export async function getUsers(): Promise<AdminUser[]> {
  const { data, errors } = await fetchGraphQL<{ users: AdminUser[] }>(USERS_QUERY);

  if (errors && errors.length > 0) {
    await redirectIfUnauthenticated(errors);
    throw new Error(errors[0]?.message || 'Error al obtener los usuarios');
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
  const name = formData.get('name');
  const username = formData.get('username');
  const password = formData.get('password');
  const passwordConfirmation = formData.get('passwordConfirmation');

  if (password !== passwordConfirmation) {
    return { error: 'Las contraseñas no coinciden' };
  }

  let result: Awaited<ReturnType<typeof fetchGraphQL>>;
  try {
    result = await fetchGraphQL(CREATE_USER_MUTATION, {
      createUserInput: { name, username, password },
    });
  } catch (err) {
    return { error: 'Error de conexión con el servidor GraphQL.' };
  }

  const { errors } = result;

  if (errors && errors.length > 0) {
    await redirectIfUnauthenticated(errors);
    // Pass through unmodified — this is what surfaces REQ-6's duplicate-username
    // message and the CreateUserInput validation messages verbatim.
    return { error: errors[0].message };
  }

  revalidatePath('/users');
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
  const id = formData.get('id');

  let result: Awaited<ReturnType<typeof fetchGraphQL>>;
  try {
    result = await fetchGraphQL(REMOVE_USER_MUTATION, { id });
  } catch (err) {
    return { error: 'Error de conexión con el servidor GraphQL.' };
  }

  const { errors } = result;

  if (errors && errors.length > 0) {
    await redirectIfUnauthenticated(errors);
    // Pass through unmodified — this is what surfaces REQ-5's self-delete and
    // last-admin messages (AC-7, AC-8) verbatim.
    return { error: errors[0].message };
  }

  revalidatePath('/users');
  return { success: true };
}
