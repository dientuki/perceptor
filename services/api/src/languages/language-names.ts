// Spec 030, REQ-7
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
