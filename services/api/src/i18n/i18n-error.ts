import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

import { ErrorKey } from '@/i18n/error-keys';
import { MESSAGES_EN } from '@/i18n/messages.en';

/**
 * Interpolation values for a keyed error. Values are stringified into the
 * English template's `{param}` placeholders and travel as-is in
 * `extensions.i18n.params` for `web`/`worker` to interpolate their own
 * catalogs against.
 */
export type I18nParams = Record<string, string | number>;

// Spec 018, T004; Spec 018, REQ-10
export interface I18nExceptionResponse {
  message: string;
  i18n: {
    key: ErrorKey;
    params?: I18nParams;
  };
}

/**
 * Renders the English template for `key`, substituting `{param}` placeholders
 * from `params`. A placeholder with no matching param is left untouched rather
 * than throwing — a missing param is a bug in the throw site, not a reason to
 * crash the request that is already failing for its own reason.
 */
function renderMessage(key: ErrorKey, params?: I18nParams): string {
  const template = MESSAGES_EN[key];
  if (template === undefined) {
    // Should never happen — `messages.en.spec.ts` asserts every ERROR_KEYS
    // entry has a template. Falling back to the key itself keeps this
    // function total rather than throwing from inside an error factory.
    return key;
  }
  if (!params) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

function buildResponse(key: ErrorKey, params?: I18nParams): I18nExceptionResponse {
  const message = renderMessage(key, params);
  return params !== undefined ? { message, i18n: { key, params } } : { message, i18n: { key } };
}

// Spec 018, REQ-7 REQ-8
export const i18nError = {
  notFound(key: ErrorKey, params?: I18nParams): NotFoundException {
    return new NotFoundException(buildResponse(key, params));
  },

  badRequest(key: ErrorKey, params?: I18nParams): BadRequestException {
    return new BadRequestException(buildResponse(key, params));
  },

  conflict(key: ErrorKey, params?: I18nParams): ConflictException {
    return new ConflictException(buildResponse(key, params));
  },

  unauthorized(key: ErrorKey, params?: I18nParams): UnauthorizedException {
    return new UnauthorizedException(buildResponse(key, params));
  },

  forbidden(key: ErrorKey, params?: I18nParams): ForbiddenException {
    return new ForbiddenException(buildResponse(key, params));
  },

  serviceUnavailable(key: ErrorKey, params?: I18nParams): ServiceUnavailableException {
    return new ServiceUnavailableException(buildResponse(key, params));
  },
};
