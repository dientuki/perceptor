// English display names for every `tag` row seeded by
// `prisma/seeds/languages.ts`. This is what the `languages` query's `name`
// field is derived from, never stored on the `Language` row itself.
// `web` renders the locale-appropriate name via `Intl.DisplayNames`
// (REQ-7, 030-language-regional-variants) — this map is no longer the
// display authority, just a stable English fallback/internal label.
export const LANGUAGE_NAMES: Record<string, string> = {
  es: 'Spanish',
  'es-419': 'Latin American Spanish',
  'es-ES': 'European Spanish',
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

// Falls back to the bare tag rather than throwing: a seed row without a name
// should still render something instead of breaking the whole `languages`
// query for every code.
export function languageNameFor(tag: string): string {
  return LANGUAGE_NAMES[tag] ?? tag;
}
