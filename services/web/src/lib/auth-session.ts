// src/lib/auth-session.ts
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { CONFIG } from '@/lib/config';

const SESSION_ERROR_MESSAGES = ['No autenticado', 'Tu sesión expiró, iniciá sesión de nuevo'];

/**
 * Checks a GraphQL `errors` array for an authentication failure, without
 * touching cookies or redirecting. Shared by `redirectIfUnauthenticated`
 * (Server Function / Route Handler callers, which may mutate cookies) and by
 * `redirectToClearSession` (Server Component render callers, which may not).
 */
export function isAuthError(errors?: any[]): boolean {
  if (!errors || errors.length === 0) {
    return false;
  }

  return errors.some((error) => SESSION_ERROR_MESSAGES.includes(error?.message));
}

/**
 * Checks a GraphQL `errors` array for an authentication failure and, if found,
 * deletes the session cookie and redirects to /login.
 *
 * Must be called immediately after `await fetchGraphQL(...)`, at the same nesting
 * level as the caller's existing error check, and never inside a `try` block —
 * `redirect()` works by throwing, and a surrounding `catch` would swallow it.
 *
 * Only call this from a Server Action / Route Handler context, where cookie
 * mutation is legal — a form action driven by `useActionState`, or a Route
 * Handler. From a Server Component render, use `redirectToClearSession`
 * instead.
 */
export async function redirectIfUnauthenticated(errors?: any[]): Promise<void> {
  if (!isAuthError(errors)) {
    return;
  }

  const cookieStore = await cookies();
  cookieStore.delete(CONFIG.authCookie);

  redirect('/login');
}

/**
 * Like `redirectIfUnauthenticated`, but for read functions a Server
 * Component awaits directly during its render pass (a page or layout
 * calling e.g. `getCurrentUser`/`getSettings`, not a form's
 * `useActionState` submission) — cookie mutation is illegal there (see
 * node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md,
 * "Understanding Cookie Behavior in Server Components"). Redirects to the
 * `/api/auth/clear-session` Route Handler, which does the actual cookie
 * deletion, instead of doing it here.
 */
export function redirectToClearSession(errors?: any[]): void {
  if (!isAuthError(errors)) {
    return;
  }

  redirect('/api/auth/clear-session');
}
