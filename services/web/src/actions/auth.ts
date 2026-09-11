"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { cache } from "react";
import { redirectToClearSession } from "@/lib/auth-session";
import { CONFIG } from "@/lib/config";
import { fetchGraphQL } from "@/lib/graphql-client";
import { translateGraphQLError } from "@/lib/graphql-error";

export interface CurrentUser {
  id: string;
  name: string;
  username: string;
  isAdmin: boolean;
  uiLocale: string | null;
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
`;

/**
 * Whether the session cookie may carry the `Secure` attribute.
 *
 * Derived from the protocol the browser actually used, never from `NODE_ENV`.
 * The published images run with `NODE_ENV=production` (the `prod` stage in
 * `services/web/Dockerfile`) while `install.sh` sets up plain HTTP — Traefik's
 * only entrypoint is `:80`, and without Traefik the stack is reached on a
 * published port. A `NODE_ENV`-driven `Secure` therefore made every browser
 * silently discard the cookie it had just been handed on any origin other than
 * localhost, so the login succeeded and the very next request was anonymous
 * again, with no error logged anywhere.
 *
 * A Server Action always receives an `Origin` header — Next requires it to
 * validate the request — and it already reflects TLS terminated in front of the
 * container. `x-forwarded-proto` is the fallback for a proxy that strips it.
 */
async function isSecureRequest(): Promise<boolean> {
  const headerStore = await headers();

  const origin = headerStore.get("origin");
  if (origin) {
    return origin.startsWith("https://");
  }

  return headerStore.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https";
}

export async function loginAction(
  redirectTo: string,
  prevState: any,
  formData: FormData,
) {
  const username = formData.get("username");
  const password = formData.get("password");
  const rememberMe = formData.get("rememberMe") === "on";
  const destination =
    redirectTo && redirectTo.startsWith("/") ? redirectTo : "/";

  try {
    const { data, errors } = await fetchGraphQL(LOGIN_MUTATION, {
      loginInput: { username, password, rememberMe },
    });

    // Manejo de errores específicos de GraphQL
    if (errors && errors.length > 0) {
      return { error: await translateGraphQLError(errors[0]) };
    }

    const token = data?.login?.access_token;
    if (!token) {
      const t = await getTranslations("errors");
      return { error: t("auth.invalidToken") };
    }

    // Guardar el token retornado en una cookie HttpOnly.
    // rememberMe: cookie persistente de 30 días. Sin tildar: cookie de sesión
    // (ni maxAge ni expires), el navegador la descarta al cerrarse.
    const cookieStore = await cookies();
    cookieStore.set(CONFIG.authCookie, token, {
      httpOnly: true,
      secure: await isSecureRequest(),
      sameSite: "lax",
      path: "/",
      ...(rememberMe ? { maxAge: 60 * 60 * 24 * 30 } : {}),
    });
  } catch (err) {
    const t = await getTranslations("errors");
    return { error: t("network.connectionFailed") };
  }

  redirect(destination);
}

const LOGOUT_MUTATION = `
  mutation Logout {
    logout
  }
`;

export async function logoutAction() {
  // Best-effort: the mutation needs the cookie still present as its bearer
  // credential, so it must run before the cookie is deleted. A failed
  // no-op logout must not prevent the user from actually signing out locally.
  try {
    await fetchGraphQL(LOGOUT_MUTATION);
  } catch (err) {
    // swallow — see comment above
  }

  const cookieStore = await cookies();
  cookieStore.delete(CONFIG.authCookie);

  redirect("/login");
}

const ME_QUERY = `
  query Me {
    me {
      id
      name
      username
      isAdmin
      uiLocale
    }
  }
`;

// The actual `me` round trip, cache()-wrapped so multiple calls within one
// request/render pass — from getCurrentUserOrNull(), getCurrentUser(), or
// a future locale resolver — dedupe to a single GraphQL request.
const fetchMe = cache(() => fetchGraphQL<{ me: CurrentUser }>(ME_QUERY));

// Non-redirecting variant: returns null on any GraphQL error (or a missing
// `me`) instead of redirecting to clear the session. This is safe to call
// from contexts that must tolerate an anonymous request — such as locale
// resolution on a public route like /login — where getCurrentUser()'s
// redirectToClearSession would otherwise loop back to the same page.
export async function getCurrentUserOrNull(): Promise<CurrentUser | null> {
  const { data, errors } = await fetchMe();

  if (errors && errors.length > 0) {
    return null;
  }

  if (!data?.me) {
    return null;
  }

  return data.me;
}

export async function getCurrentUser(): Promise<CurrentUser> {
  const user = await getCurrentUserOrNull();

  if (!user) {
    // getCurrentUser() is only ever called from a Server Component's render
    // pass (the dashboard layout, the users page) — cookies can't be
    // mutated there, only read. redirectToClearSession hands the actual
    // cookie deletion off to a Route Handler instead of doing it here (which
    // is what redirectIfUnauthenticated does, and would crash in this
    // context). See src/app/api/auth/clear-session/route.ts.
    // fetchMe() is cache()-wrapped, so this re-read is the same request as
    // the one getCurrentUserOrNull() already made — no second round trip.
    const { errors } = await fetchMe();
    redirectToClearSession(errors);
    if (errors?.[0]) {
      throw new Error(await translateGraphQLError(errors[0]));
    }
    const t = await getTranslations("errors");
    throw new Error(t("auth.currentUserFailed"));
  }

  return user;
}
