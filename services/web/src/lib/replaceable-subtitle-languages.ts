import type { Language } from "@/types/languages";

// Spec 119, T007
export function replaceableSubtitleLanguages(
  fileSubtitleLanguages: string[] | null | undefined,
  wanted: Language[],
): string[] {
  if (!fileSubtitleLanguages) return [];
  const inFile = new Set(fileSubtitleLanguages.map((c) => c.toLowerCase()));
  const result: string[] = [];
  for (const language of wanted) {
    const iso3 = language.iso3.toLowerCase();
    if (inFile.has(iso3) && !result.includes(iso3)) result.push(iso3);
  }
  return result;
}
