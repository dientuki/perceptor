import { SubtitleProviderKind } from '@prisma/client';
import { SUBTITLE_PROVIDER_KINDS, servesLanguage } from './registry';

export type ProviderLanguage = {
  languageTag: string;
  provider: SubtitleProviderKind;
};

export function isProviderKind(value: unknown): value is SubtitleProviderKind {
  return (
    typeof value === 'string' &&
    (SUBTITLE_PROVIDER_KINDS as readonly string[]).includes(value)
  );
}

// Spec 121, REQ-5
export function effectiveDefault(
  stored: string | undefined,
  configured: readonly SubtitleProviderKind[],
): SubtitleProviderKind | null {
  if (isProviderKind(stored) && configured.includes(stored)) return stored;
  return SUBTITLE_PROVIDER_KINDS.find((kind) => configured.includes(kind)) ?? null;
}

// Spec 121, REQ-7
export function parseLanguages(
  raw: string | undefined,
  onGarbage?: () => void,
): ProviderLanguage[] {
  if (raw === undefined || raw.trim() === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    onGarbage?.();
    return [];
  }
  if (!Array.isArray(parsed)) {
    onGarbage?.();
    return [];
  }
  const languages: ProviderLanguage[] = [];
  const seen = new Set<string>();
  let garbage = false;
  for (const item of parsed) {
    const tag = (item as { languageTag?: unknown } | null)?.languageTag;
    const provider = (item as { provider?: unknown } | null)?.provider;
    if (typeof tag !== 'string' || tag === '' || !isProviderKind(provider) || seen.has(tag)) {
      garbage = true;
      continue;
    }
    seen.add(tag);
    languages.push({ languageTag: tag, provider });
  }
  if (garbage) onGarbage?.();
  return languages;
}

export type ChainInput = {
  iso3: string;
  variantTag: string | null | undefined;
  baseTag: string | null | undefined;
  configured: readonly SubtitleProviderKind[];
  defaultKind: SubtitleProviderKind | null;
  languages: readonly ProviderLanguage[];
};

// Spec 121, REQ-7
export function chain(input: ChainInput): SubtitleProviderKind[] {
  const languageFor = (tag: string | null | undefined) =>
    tag ? input.languages.find((entry) => entry.languageTag === tag)?.provider : undefined;

  const preferred = languageFor(input.variantTag) ?? languageFor(input.baseTag);

  const ordered: SubtitleProviderKind[] = [];
  for (const kind of [preferred, input.defaultKind]) {
    if (!kind || ordered.includes(kind)) continue;
    if (!input.configured.includes(kind)) continue;
    if (!servesLanguage(kind, input.iso3)) continue;
    ordered.push(kind);
  }
  return ordered;
}
