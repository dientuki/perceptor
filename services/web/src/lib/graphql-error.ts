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
      /** A JSON-encoded object, not a JSON scalar — both sides `JSON.parse` it. */
      params?: string;
    };
  };
}

/** Every key in the frozen vocabulary starts with this; the rest is the catalog path. */
const ERROR_KEY_PREFIX = "error.";

/**
 * Turns a raw GraphQL error into a string safe to render on screen.
 *
 * `extensions.i18n.key` (e.g. `error.auth.unauthenticated`) is looked up in the
 * `errors` namespace of the active locale's catalog, dropping the leading
 * `error.` — so `error.auth.unauthenticated` resolves to `errors.auth.unauthenticated`
 * in `messages/<locale>.json`. `extensions.i18n.params`, when present, is a
 * JSON-encoded object interpolated into the translation.
 *
 * Falls back to the English `message` api always sends (REQ-8) whenever there is
 * no key, the key has no catalog entry (a key `web`'s catalogs have not caught up
 * with yet — see `018-ui-i18n/plan.md`'s "Key drift" risk), or `params` fails to
 * parse. This function must never return the raw key string.
 */
export async function translateGraphQLError(
  error: GraphQLErrorLike,
): Promise<string> {
  const key = error.extensions?.i18n?.key;
  if (!key || !key.startsWith(ERROR_KEY_PREFIX)) {
    return error.message;
  }

  const path = key.slice(ERROR_KEY_PREFIX.length);

  let values: Record<string, unknown> | undefined;
  const rawParams = error.extensions?.i18n?.params;
  if (rawParams) {
    try {
      values = JSON.parse(rawParams);
    } catch {
      return error.message;
    }
  }

  const t = await getTranslations("errors");
  if (!t.has(path)) {
    return error.message;
  }

  try {
    return t(
      path,
      values as Record<string, string | number | Date> | undefined,
    );
  } catch {
    return error.message;
  }
}
