/**
 * The single list of locales `web` supports (REQ-17, REQ-18, REQ-19).
 *
 * Hand-synced with `services/api/src/i18n/locales.ts` — there is no codegen between the two
 * services, so a locale added here without a matching entry there (or vice versa) is a bug, not a
 * compile error. Nothing else in `web` may hardcode a locale list or branch on a specific locale
 * value.
 */
export const SUPPORTED_LOCALES = ["en", "es"] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** `en` is the one deliberate exception: it is the fallback when nothing else resolves. */
export const DEFAULT_LOCALE: SupportedLocale = "en";

export function isSupportedLocale(locale: string): locale is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(locale);
}
