// Spec 031, REQ-2

import { normalizeIso3 } from './iso639';

export function titleWords(stream: any): string[] {
  return (stream.tags?.title || '')
    .toLowerCase()
    .split(/[^a-z0-9À-ſ-]+/)
    .filter((word: string) => word.length > 0);
}

export function titleMarks(stream: any, markers: string[]): boolean {
  const words = titleWords(stream);
  const joined = words.join(' ');
  return markers.some((marker) =>
    marker.includes(' ') ? joined.includes(marker) : words.includes(marker),
  );
}

// The "keep the better ones, but never empty the set" decision every
// evidence-based rule in this service shares — the SDH drop, the variant
// narrowing below, and (unchanged) the audio/subtitle regional preference.
export function preferring<T>(streams: T[], isWorse: (stream: T) => boolean): T[] {
  const better = streams.filter((stream) => !isWorse(stream));
  return better.length > 0 ? better : streams;
}

export interface LanguageVariant {
  tag: string;
  iso3: string;
  markers: string[];
  title: string;
}

const LATIN_AMERICAN_MARKERS = ['latino', 'latin america', 'latinoamerica', 'latin', 'la', '419'];
const CASTILIAN_MARKERS = ['españa', 'spain', 'castellano', 'eu', 'es-es'];

const LANGUAGE_VARIANTS: LanguageVariant[] = [
  { tag: 'es-419', iso3: 'spa', markers: LATIN_AMERICAN_MARKERS, title: 'Latino' },
  { tag: 'es-ES', iso3: 'spa', markers: CASTILIAN_MARKERS, title: 'Español (España)' },
];

// Spec 031, REQ-3
export function detectVariant(stream: any): string | undefined {
  const variant = LANGUAGE_VARIANTS.find((v) => titleMarks(stream, v.markers));
  return variant?.tag;
}

// Spec 031, REQ-12 REQ-18
export function variantTitle(tag: string): string | undefined {
  return LANGUAGE_VARIANTS.find((v) => v.tag === tag)?.title;
}

const warnedTagsByList = new WeakMap<string[], Set<string>>();

function warnUnresolvedTagOnce(allowedLanguageTags: string[], tag: string): void {
  let warned = warnedTagsByList.get(allowedLanguageTags);
  if (!warned) {
    warned = new Set();
    warnedTagsByList.set(allowedLanguageTags, warned);
  }
  if (warned.has(tag)) return;
  warned.add(tag);
  console.warn(
    `[ffmpeg] requested language tag "${tag}" carries a region subtag no known variant resolves; treating it as no preference.`,
  );
}

// Spec 031, REQ-2 REQ-6
export function requestedVariants(
  iso3: string,
  allowedLanguageTags: string[],
): LanguageVariant[] {
  const lang = normalizeIso3(iso3);
  const regionalTags = (allowedLanguageTags || [])
    .map((tag) => (tag || '').trim())
    .filter((tag) => tag.includes('-'));

  const known = new Set(LANGUAGE_VARIANTS.map((v) => v.tag.toLowerCase()));
  regionalTags.forEach((tag) => {
    if (!known.has(tag.toLowerCase())) {
      warnUnresolvedTagOnce(allowedLanguageTags, tag);
    }
  });

  return LANGUAGE_VARIANTS.filter(
    (variant) =>
      normalizeIso3(variant.iso3) === lang &&
      regionalTags.some((tag) => tag.toLowerCase() === variant.tag.toLowerCase()),
  );
}

// Spec 031, REQ-4 REQ-5
export type VariantNarrowing<T> =
  | { matched: true; groups: { tag: string; streams: T[] }[] }
  | { matched: false; streams: T[] };

// Spec 031, REQ-4 REQ-5
export function narrowToVariants<T>(
  streams: T[],
  requestedForLang: LanguageVariant[],
  detect: (stream: T) => string | undefined = detectVariant,
): VariantNarrowing<T> {
  const isRequestedVariant = (stream: T) =>
    requestedForLang.some((variant) => variant.tag === detect(stream));

  const anyMatched = streams.some(isRequestedVariant);
  if (!anyMatched) return { matched: false, streams };

  const matched = preferring(streams, (stream) => !isRequestedVariant(stream));

  const groups = requestedForLang
    .map((variant) => ({
      tag: variant.tag,
      streams: matched.filter((stream) => detect(stream) === variant.tag),
    }))
    .filter((group) => group.streams.length > 0);

  return { matched: true, groups };
}
