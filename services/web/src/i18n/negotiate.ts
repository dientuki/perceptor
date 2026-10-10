import { match } from "@formatjs/intl-localematcher";
import Negotiator from "negotiator";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from "@/i18n/locales";

// Spec 018, REQ-2
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
