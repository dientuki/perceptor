// Spec 107, T004
export type LanguageRow = { tag: string; iso2: string; iso3: string };

const ISO3_ALIASES: Record<string, string> = {
  fra: 'fre',
  deu: 'ger',
  zho: 'chi',
  ces: 'cze',
  nld: 'dut',
  ell: 'gre',
  isl: 'ice',
  hye: 'arm',
  kat: 'geo',
  mkd: 'mac',
  mri: 'mao',
  msa: 'may',
  fas: 'per',
  ron: 'rum',
  slk: 'slo',
  bod: 'tib',
  cym: 'wel',
  eus: 'baq',
  mya: 'bur',
  sqi: 'alb',
};

export function resolveSidecarLanguages(
  tags: string[],
  languages: LanguageRow[],
): string[] {
  const byTag = new Map(languages.map((l) => [l.tag.toLowerCase(), l]));
  const iso3s = new Set(languages.map((l) => l.iso3.toLowerCase()));
  const found = new Set<string>();

  for (const raw of tags) {
    const tag = raw.trim().toLowerCase();
    if (tag === '') continue;

    const exact = byTag.get(tag);
    if (exact) {
      found.add(exact.iso3);
      continue;
    }

    const base = tag.split(/[-_]/)[0];
    const byBase = byTag.get(base);
    if (byBase) {
      found.add(byBase.iso3);
      continue;
    }

    if (/^[a-z]{3}$/.test(tag)) {
      const candidate = ISO3_ALIASES[tag] ?? tag;
      if (iso3s.has(candidate)) {
        found.add(
          languages.find((l) => l.iso3.toLowerCase() === candidate)!.iso3,
        );
      }
    }
  }

  return [...found];
}
