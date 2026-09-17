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

/**
 * Turns a raw GraphQL error into a string safe to render on screen.
 *
 * `extensions.i18n.key` (e.g. `error.auth.unauthenticated`) is looked up in the
 * `errors` namespace of the active locale's catalog, dropping the leading
 * `error.` — so `error.auth.unauthenticated` resolves to `errors.auth.unauthenticated`
 * in `messages/<locale>.json`. `extensions.i18n.params`, when present, is interpolated
 * into the translation as-is — it arrives as a plain object, not a JSON-encoded
 * string (`docs/spec/graphql-contract.md`'s error envelope example, and
 * `importFileModal.tsx`'s REST-path reading of the same shape, agree on this).
 *
 * Falls back to the English `message` api always sends (REQ-8) whenever there is
 * no key or the key has no catalog entry (a key `web`'s catalogs have not caught up
 * with yet — see `018-ui-i18n/plan.md`'s "Key drift" risk). This function must never
 * return the raw key string.
 */
export async function translateGraphQLError(
  error: GraphQLErrorLike,
): Promise<string> {
  const key = error.extensions?.i18n?.key;
  if (!key || !key.startsWith(ERROR_KEY_PREFIX)) {
    return error.message;
  }

  const path = key.slice(ERROR_KEY_PREFIX.length);
  const values = error.extensions?.i18n?.params;

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

/**
 * Turns a raw GraphQL error into the `{ error, errorKey }` shape a Server
 * Action returns instead of throwing. `errorKey` is `extensions.i18n.key`
 * passed through untouched — no `error.` prefix strip, unlike
 * `translateGraphQLError`'s internal lookup — because components compare
 * against the full `error.movie.already_completed` form to decide which
 * confirmation to offer (REQ-11). A plain `throw new Error(...)` loses this
 * key at the boundary, which is why a Server Action returns it instead.
 */
export async function toActionError(
  error: GraphQLErrorLike,
): Promise<{ error: string; errorKey?: string }> {
  return {
    error: await translateGraphQLError(error),
    errorKey: error.extensions?.i18n?.key,
  };
}
