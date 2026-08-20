import { match } from "@formatjs/intl-localematcher";
import Negotiator from "negotiator";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from "@/i18n/locales";

/**
 * Resolves an `Accept-Language` header against `SUPPORTED_LOCALES` by language range, so
 * `es-AR`, `es-419` and `es` all resolve to `es`, and a header with no supported range falls back
 * to `DEFAULT_LOCALE` (REQ-2).
 */
export function negotiateLocale(
  acceptLanguageHeader: string | null,
): SupportedLocale {
  if (!acceptLanguageHeader) {
    return DEFAULT_LOCALE;
  }

  const negotiator = new Negotiator({
    headers: { "accept-language": acceptLanguageHeader },
  });
  const requestedLocales = negotiator.languages();

  const resolved = match(requestedLocales, SUPPORTED_LOCALES, DEFAULT_LOCALE);

  return SUPPORTED_LOCALES.includes(resolved as SupportedLocale)
    ? (resolved as SupportedLocale)
    : DEFAULT_LOCALE;
}
