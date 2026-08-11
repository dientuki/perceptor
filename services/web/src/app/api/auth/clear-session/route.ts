// src/app/api/auth/clear-session/route.ts
import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { CONFIG } from '@/lib/config';

/**
 * Deletes the session cookie and redirects to /login.
 *
 * Cookie mutation (`.delete()`) is illegal during a Server Component's render
 * pass — it's only permitted in a Server Function or a Route Handler (see
 * node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md
 * "Understanding Cookie Behavior in Server Components"). `getCurrentUser()`
 * (`@/actions/auth.ts`) is called exclusively from Server Components (the
 * dashboard layout, the users page), so on an auth error it redirects here
 * instead of trying to delete the cookie itself. This is the one place that
 * actually clears it for that call path — without it, an invalid cookie stays
 * on the browser and `src/proxy.ts`'s presence-only check on `/login` would
 * bounce straight back to `/dashboard`.
 */
export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  cookieStore.delete(CONFIG.authCookie);

  return NextResponse.redirect(new URL('/login', request.url));
}
