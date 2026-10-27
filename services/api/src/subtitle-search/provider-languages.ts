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
