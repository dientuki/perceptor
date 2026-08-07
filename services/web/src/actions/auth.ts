'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { fetchGraphQL } from '@/lib/graphql-client';
import { CONFIG } from '@/lib/config';

const LOGIN_MUTATION = `
  mutation Login($loginInput: LoginInput!) {
    login(loginInput: $loginInput) {
      access_token
      user {
        id
        name
        username
      }
    }
  }
`

export async function loginAction(redirectTo: string, prevState: any, formData: FormData) {
  const username = formData.get('username')
  const password = formData.get('password')
  const destination = (redirectTo && redirectTo.startsWith('/')) ? redirectTo : '/dashboard';

  try {
    const { data, errors } = await fetchGraphQL(LOGIN_MUTATION, {
        loginInput: { username, password }
    });

    // Manejo de errores específicos de GraphQL
    if (errors && errors.length > 0) {
      return { error: errors[0].message || 'Error al iniciar sesión' }
    }

    const token = data?.login?.access_token
    if (!token) {
      return { error: 'No se recibió un token válido.' }
    }

    // Guardar el token retornado en una cookie HttpOnly
    const cookieStore = await cookies()
    cookieStore.set(CONFIG.authTtoken, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7, // 7 días
    })
    
  } catch (err) {
    return { error: 'Error de conexión con el servidor GraphQL.' }
  }

  redirect(destination)
}