/**
 * The single list of locales the whole system supports (REQ-17, REQ-18, REQ-19).
 *
 * `web` ships a catalog file per entry here; nothing else may hardcode a locale
 * list or branch on a specific locale value. Adding a locale costs a catalog file
 * in `web` plus one entry in this array — nothing else.
 */
export const SUPPORTED_LOCALES = ['en', 'es'] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** `en` is the one deliberate exception: it is the fallback when nothing else resolves. */
export const DEFAULT_LOCALE: SupportedLocale = 'en';

export function isSupportedLocale(locale: string): locale is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(locale);
}
