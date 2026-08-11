'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { fetchGraphQL } from '@/lib/graphql-client';
import { redirectToClearSession } from '@/lib/auth-session';
import { CONFIG } from '@/lib/config';

export interface CurrentUser {
  id: string;
  name: string;
  username: string;
  isAdmin: boolean;
}

const LOGIN_MUTATION = `
  mutation Login($loginInput: LoginInput!) {
    login(loginInput: $loginInput) {
      access_token
      user {
        id
        name
        username
        isAdmin
      }
    }
  }
`

export async function loginAction(redirectTo: string, prevState: any, formData: FormData) {
  const username = formData.get('username')
  const password = formData.get('password')
  const rememberMe = formData.get('rememberMe') === 'on'
  const destination = (redirectTo && redirectTo.startsWith('/')) ? redirectTo : '/dashboard';

  try {
    const { data, errors } = await fetchGraphQL(LOGIN_MUTATION, {
        loginInput: { username, password, rememberMe }
    });

    // Manejo de errores específicos de GraphQL
    if (errors && errors.length > 0) {
      return { error: errors[0].message || 'Error al iniciar sesión' }
    }

    const token = data?.login?.access_token
    if (!token) {
      return { error: 'No se recibió un token válido.' }
    }

    // Guardar el token retornado en una cookie HttpOnly.
    // rememberMe: cookie persistente de 30 días. Sin tildar: cookie de sesión
    // (ni maxAge ni expires), el navegador la descarta al cerrarse.
    const cookieStore = await cookies()
    cookieStore.set(CONFIG.authCookie, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      ...(rememberMe ? { maxAge: 60 * 60 * 24 * 30 } : {}),
    })

  } catch (err) {
    return { error: 'Error de conexión con el servidor GraphQL.' }
  }

  redirect(destination)
}

const LOGOUT_MUTATION = `
  mutation Logout {
    logout
  }
`

export async function logoutAction() {
  // Best-effort: the mutation needs the cookie still present as its bearer
  // credential, so it must run before the cookie is deleted. A failed
  // no-op logout must not prevent the user from actually signing out locally.
  try {
    await fetchGraphQL(LOGOUT_MUTATION)
  } catch (err) {
    // swallow — see comment above
  }

  const cookieStore = await cookies()
  cookieStore.delete(CONFIG.authCookie)

  redirect('/login')
}

const ME_QUERY = `
  query Me {
    me {
      id
      name
      username
      isAdmin
    }
  }
`

export async function getCurrentUser(): Promise<CurrentUser> {
  const { data, errors } = await fetchGraphQL<{ me: CurrentUser }>(ME_QUERY);

  if (errors && errors.length > 0) {
    // getCurrentUser() is only ever called from a Server Component's render
    // pass (the dashboard layout, the users page) — cookies can't be
    // mutated there, only read. redirectToClearSession hands the actual
    // cookie deletion off to a Route Handler instead of doing it here (which
    // is what redirectIfUnauthenticated does, and would crash in this
    // context). See src/app/api/auth/clear-session/route.ts.
    redirectToClearSession(errors);
    throw new Error(errors[0]?.message || 'Error al obtener el usuario actual');
  }

  if (!data?.me) {
    throw new Error('El API no devolvió el usuario actual');
  }

  return data.me;
}
