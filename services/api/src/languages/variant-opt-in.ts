import { LanguageTrackKind } from '@prisma/client';

type LanguageRows = Array<{ kind: LanguageTrackKind; language: { tag: string; iso3: string } }>;

export interface VariantOptInOwner {
  languages: LanguageRows;
  user: { audioVariantDetection: boolean; languages: LanguageRows };
}

// Spec 118, REQ-3
export const VARIANT_TRACK_TITLES: Record<string, string> = {
  'es-419': 'Latino',
  'es-ES': 'Español (España)',
};

// Spec 118, REQ-3
export function wantsVariantDetection(
  owner: VariantOptInOwner,
  kind: LanguageTrackKind,
  variantIso3s: ReadonlySet<string>,
): boolean {
  return (
    owner.user.audioVariantDetection &&
    [...owner.languages, ...owner.user.languages].some(
      (pref) => pref.kind === kind && variantIso3s.has(pref.language.iso3),
    )
  );
}

// Spec 118, REQ-3
export function wantedVariants(
  owners: VariantOptInOwner[],
  variantIso3s: ReadonlySet<string>,
): Record<string, string> | null {
  const qualifying = owners.filter((owner) =>
    wantsVariantDetection(owner, LanguageTrackKind.SUBTITLE, variantIso3s),
  );
  if (qualifying.length === 0) return null;

  const tagsByIso3 = new Map<string, Set<string>>();
  for (const owner of qualifying) {
    for (const pref of [...owner.languages, ...owner.user.languages]) {
      if (pref.kind !== LanguageTrackKind.SUBTITLE) continue;
      if (!variantIso3s.has(pref.language.iso3) || !pref.language.tag.includes('-')) continue;
      const tags = tagsByIso3.get(pref.language.iso3) ?? new Set<string>();
      tags.add(pref.language.tag);
      tagsByIso3.set(pref.language.iso3, tags);
    }
  }

  const wanted: Record<string, string> = {};
  for (const [iso3, tags] of tagsByIso3) {
    if (tags.size === 1) wanted[iso3] = [...tags][0];
  }
  return wanted;
}
