import type { Language } from "@/types/languages";

export interface SubtitleFilePreset {
  languageTag: string | null;
  isForced: boolean;
}

const LATINO_TAG = "es-419";

function displayName(locale: string, tag: string): string | null {
  try {
    return (
      new Intl.DisplayNames([locale], { type: "language" }).of(tag) ?? null
    );
  } catch {
    return null;
  }
}

function exactMatch(segment: string, language: Language): boolean {
  const needle = segment.toLowerCase();
  return (
    language.tag.toLowerCase() === needle ||
    (language.tag === LATINO_TAG && needle === "latino")
  );
}

function looseMatch(segment: string, language: Language): boolean {
  const needle = segment.toLowerCase();
  const names = [
    language.iso2,
    language.iso3,
    language.name,
    displayName("es", language.tag),
    displayName("en", language.tag),
  ];
  return names.some((name) => name?.toLowerCase() === needle);
}

// Spec 124, REQ-5
export function presetFromFileName(
  fileName: string,
  languages: Language[],
): SubtitleFilePreset {
  const segments = fileName
    .replace(/\.srt$/i, "")
    .split(".")
    .reverse();
  let isForced = false;
  let languageTag: string | null = null;
  let ambiguous = false;

  for (const segment of segments) {
    if (segment.toLowerCase() === "forced") {
      isForced = true;
      continue;
    }
    if (languageTag !== null || ambiguous || segment === "") continue;
    const exact = languages.find((candidate) => exactMatch(segment, candidate));
    if (exact) {
      languageTag = exact.tag;
      continue;
    }
    const loose = languages.filter((candidate) =>
      looseMatch(segment, candidate),
    );
    if (loose.length === 1) {
      languageTag = loose[0].tag;
    } else if (loose.length > 1) {
      ambiguous = true;
    }
  }

  return { languageTag, isForced };
}
