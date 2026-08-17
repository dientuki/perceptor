// Spanish display names for every `iso2` row seeded by
// `prisma/seeds/languages.ts`. User-facing copy, so Spanish (Article VI's
// stated exception) — this is what the `languages` query's `name` field is
// derived from, never stored on the `Language` row itself.
export const LANGUAGE_NAMES: Record<string, string> = {
  es: 'Español',
  en: 'Inglés',
  pt: 'Portugués',
  ja: 'Japonés',
  ko: 'Coreano',
  fr: 'Francés',
  de: 'Alemán',
  it: 'Italiano',
  zh: 'Chino',
  ru: 'Ruso',
  hi: 'Hindi',
  ar: 'Árabe',
  sv: 'Sueco',
  da: 'Danés',
  nl: 'Neerlandés',
  nb: 'Noruego',
  pl: 'Polaco',
  tr: 'Turco',
  th: 'Tailandés',
  cs: 'Checo',
};

// Falls back to the bare iso2 code rather than throwing: a seed row without a
// Spanish name should still render something in the UI instead of breaking
// the whole `languages` query for every code.
export function languageNameFor(iso2: string): string {
  return LANGUAGE_NAMES[iso2] ?? iso2;
}
