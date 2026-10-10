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

// Spec 018, T004; Spec 018, REQ-7; Spec 018, REQ-14
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
