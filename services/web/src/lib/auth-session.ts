// src/lib/auth-session.ts
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { CONFIG } from '@/lib/config';

const SESSION_ERROR_MESSAGES = ['No autenticado', 'Tu sesión expiró, iniciá sesión de nuevo'];

/**
 * Checks a GraphQL `errors` array for an authentication failure and, if found,
 * deletes the session cookie and redirects to /login.
 *
 * Must be called immediately after `await fetchGraphQL(...)`, at the same nesting
 * level as the caller's existing error check, and never inside a `try` block —
 * `redirect()` works by throwing, and a surrounding `catch` would swallow it.
 */
export async function redirectIfUnauthenticated(errors?: any[]): Promise<void> {
  if (!errors || errors.length === 0) {
    return;
  }

  const isAuthError = errors.some((error) => SESSION_ERROR_MESSAGES.includes(error?.message));

  if (!isAuthError) {
    return;
  }

  const cookieStore = await cookies();
  cookieStore.delete(CONFIG.authCookie);

  redirect('/login');
}
