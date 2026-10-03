// src/lib/graphql-error.ts
import { getTranslations } from "next-intl/server";

/**
 * The shape of a raw GraphQL error object, as returned in the `errors` array
 * of `fetchGraphQL`'s response. `extensions.i18n` is `api`'s keyed error
 * envelope (`docs/spec/features/018-ui-i18n/spec.md` § "The error envelope").
 */
export interface GraphQLErrorLike {
  message: string;
  extensions?: {
    i18n?: {
      key?: string;
      /** A plain object, exactly as `api` attaches it — never a JSON-encoded string. */
      params?: Record<string, unknown>;
    };
  };
}

/** Every key in the frozen vocabulary starts with this; the rest is the catalog path. */
const ERROR_KEY_PREFIX = "error.";

// Spec 018, REQ-8
export interface ErrorTranslator {
  (path: string, values?: Record<string, string | number | Date>): string;
  has(path: string): boolean;
}

export function translateErrorKey(
  t: ErrorTranslator,
  key: string | undefined,
  params: Record<string, unknown> | undefined,
  fallback: string,
): string {
  if (!key || !key.startsWith(ERROR_KEY_PREFIX)) {
    return fallback;
  }

  const path = key.slice(ERROR_KEY_PREFIX.length);
  if (!t.has(path)) {
    return fallback;
  }

  try {
    return t(
      path,
      params as Record<string, string | number | Date> | undefined,
    );
  } catch {
    return fallback;
  }
}

export async function translateGraphQLError(
  error: GraphQLErrorLike,
): Promise<string> {
  const key = error.extensions?.i18n?.key;
  if (!key || !key.startsWith(ERROR_KEY_PREFIX)) {
    return error.message;
  }

  const t = await getTranslations("errors");
  return translateErrorKey(
    t,
    key,
    error.extensions?.i18n?.params,
    error.message,
  );
}

// Spec 027, REQ-11
export async function toActionError(
  error: GraphQLErrorLike,
): Promise<{ error: string; errorKey?: string }> {
  return {
    error: await translateGraphQLError(error),
    errorKey: error.extensions?.i18n?.key,
  };
}
