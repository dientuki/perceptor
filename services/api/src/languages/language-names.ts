// English display names for every `iso2` row seeded by
// `prisma/seeds/languages.ts`. This is what the `languages` query's `name`
// field is derived from, never stored on the `Language` row itself.
// `web` renders the locale-appropriate name via `Intl.DisplayNames`
// (REQ-13, 018-ui-i18n) — this map is no longer the display authority, just
// a stable English fallback/internal label.
export const LANGUAGE_NAMES: Record<string, string> = {
  es: 'Spanish',
  en: 'English',
  pt: 'Portuguese',
  ja: 'Japanese',
  ko: 'Korean',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  zh: 'Chinese',
  ru: 'Russian',
  hi: 'Hindi',
  ar: 'Arabic',
  sv: 'Swedish',
  da: 'Danish',
  nl: 'Dutch',
  nb: 'Norwegian',
  pl: 'Polish',
  tr: 'Turkish',
  th: 'Thai',
  cs: 'Czech',
};

// Falls back to the bare iso2 code rather than throwing: a seed row without a
// name should still render something instead of breaking the whole
// `languages` query for every code.
export function languageNameFor(iso2: string): string {
  return LANGUAGE_NAMES[iso2] ?? iso2;
}
