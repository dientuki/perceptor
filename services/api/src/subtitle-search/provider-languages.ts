// Spec 107, T004 REQ-6
import { LanguageRow } from './sidecar-languages';

const EXPANSIONS: Record<string, string[]> = {
  por: ['pt-pt', 'pt-br'],
  chi: ['zh-cn', 'zh-tw'],
};

export function providerLanguageCodes(
  iso3: string,
  languages: LanguageRow[],
): string[] {
  const expanded = EXPANSIONS[iso3.toLowerCase()];
  if (expanded) return expanded;

  const row = languages.find(
    (l) => l.iso3.toLowerCase() === iso3.toLowerCase() && !l.tag.includes('-'),
  );
  return row ? [row.tag.toLowerCase()] : [];
}

// Spec 118, REQ-13
export const PROVIDER_VARIANT_CODES: Record<string, string> = {
  'es-419': 'ea',
};

// Spec 118, REQ-13
export function providerVariantCode(tag: string): string | null {
  return PROVIDER_VARIANT_CODES[tag] ?? null;
}
