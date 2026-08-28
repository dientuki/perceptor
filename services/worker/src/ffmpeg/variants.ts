// src/ffmpeg/variants.ts
//
// Worker-local knowledge about how a language's regional variants appear in
// a file — the title vocabulary (L1 in .claude/agents/ffmpeg.md) and the
// primitives the audio/subtitle rules narrow selection with. Only `spa` has
// seeded variants today (es-419, es-ES); the shape below is written to be
// generic over "a language with requested variants" rather than a
// Spanish-specific rule, per REQ-2 of
// docs/spec/features/031-worker-language-variants/spec.md.
//
// params.ts imports from here; nothing here imports from params.ts. Keeping
// the dependency one-directional is what lets both files reuse the same
// word-boundary matcher and the same "keep everything rather than empty the
// set" decision without a circular import.

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

// REQ-3: unconditional — this runs whether or not the user requested a
// variant, because the output track title depends on it regardless of who
// triggered the encode. Never takes the request into account.
export function detectVariant(stream: any): string | undefined {
  const variant = LANGUAGE_VARIANTS.find((v) => titleMarks(stream, v.markers));
  return variant?.tag;
}

// REQ-12/REQ-18: the title a detected variant writes to the output. Kept
// beside the tag table so a new variant row carries its title with it
// rather than a second, separately-maintained map in params.ts.
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

// REQ-2: which of the caller's requested tags are regional variants of
// `iso3`. A bare tag with no region subtag ("es", "en") is never a variant
// request — that is REQ-6, the no-preference case. A tag that does carry a
// region subtag but resolves to no row in LANGUAGE_VARIANTS is logged once
// per distinct `allowedLanguageTags` array and otherwise ignored, never
// thrown and never read as a request for a language it cannot identify.
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

// The caller's two REQ-4/REQ-5 branches, discriminated by value rather than
// by the caller checking whether narrowToVariants happened to return its own
// array back by reference — that coupling breaks silently the day this
// function's internals change shape without changing behaviour.
export type VariantNarrowing<T> =
  | { matched: true; groups: { tag: string; streams: T[] }[] }
  | { matched: false; streams: T[] };

// REQ-4/REQ-5: `streams` is already narrowed to one language. With at least
// one stream detected as a requested variant, `matched: true` and every
// requested tag with at least one surviving stream gets its own group. With
// none, `matched: false` and every stream of the language survives,
// ungrouped — the "keep everything rather than empty the set" fallback,
// built on `preferring`'s decision rather than a second reimplementation of
// it.
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
