// src/lib/graphql-client.ts
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { CONFIG } from "@/lib/config";

export async function fetchGraphQL<T = any>(
  query: string,
  variables?: Record<string, any>,
  options: RequestInit = {},
): Promise<{ data?: T; errors?: any[] }> {
  const cookieStore = await cookies();
  const token = cookieStore.get(CONFIG.authCookie)?.value;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(CONFIG.graphqlUrl, {
    ...options,
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  });

  try {
    return await res.json();
  } catch {
    // This literal never surfaces on screen through `translateGraphQLError`'s
    // `error.message` fallback, since it has no `extensions.i18n.key` — it is
    // translated here directly, in the caller's locale, since `fetchGraphQL`
    // runs in the same request scope as `cookies()` above.
    const t = await getTranslations("errors");
    return {
      errors: [{ message: t("network.invalidResponse") }],
    };
  }
}
