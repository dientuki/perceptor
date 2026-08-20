import { HttpException } from '@nestjs/common';
import { GraphQLError, GraphQLFormattedError } from 'graphql';

import { I18nExceptionResponse } from '@/i18n/i18n-error';

function isI18nResponse(value: unknown): value is I18nExceptionResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'i18n' in value &&
    typeof (value as { i18n?: unknown }).i18n === 'object' &&
    (value as { i18n?: unknown }).i18n !== null
  );
}

/**
 * `formatError` for `GraphQLModule.forRoot` (018 T004). Lifts the `i18n`
 * object that `i18nError.*` factories (`i18n-error.ts`) attach to a thrown
 * `HttpException`'s response body onto the outgoing GraphQL error's
 * `extensions.i18n`, so `web`/`worker` can match on a stable key instead of
 * the English `message` (REQ-7, REQ-14).
 *
 * Where the key lives on the wire: graphql-js wraps whatever a resolver
 * throws in a `GraphQLError` via `locatedError()`, setting `.originalError`
 * to the exact exception instance that was thrown (not a copy, not a
 * serialization) — see `graphql/error/locatedError.js`. That `GraphQLError`
 * is the second argument Apollo hands to `formatError`. `@nestjs/apollo`
 * additionally auto-transforms `HttpException`s whose response body already
 * carries a `statusCode` (`createTransformHttpErrorFn` in
 * `@nestjs/apollo/dist/drivers/apollo-base.driver.js`) onto
 * `formattedError.extensions.originalError` — but `i18nError.*` builds a
 * response body of exactly `{ message, i18n }`, with no `statusCode`, so
 * that auto-transform's own guard (`exceptionRef.response.statusCode`)
 * never fires and `extensions.originalError` is never populated. This
 * formatter therefore reads the key from `error.originalError` directly,
 * not from anything Nest may or may not have already lifted.
 *
 * An error with no `i18n` — an unexpected 500, a Prisma error, anything not
 * thrown through `i18nError` — passes through unchanged. Inventing a key for
 * it here would be worse than omitting one: a consumer that trusts
 * `extensions.i18n.key` would render a translated sentence for an error that
 * was never classified.
 */
export function formatGraphQLError(
  formattedError: GraphQLFormattedError,
  error: unknown,
): GraphQLFormattedError {
  const originalError = error instanceof GraphQLError ? error.originalError : undefined;
  const response = originalError instanceof HttpException ? originalError.getResponse() : undefined;

  if (!isI18nResponse(response)) {
    return formattedError;
  }

  return {
    ...formattedError,
    extensions: {
      ...formattedError.extensions,
      i18n: response.i18n,
    },
  };
}
