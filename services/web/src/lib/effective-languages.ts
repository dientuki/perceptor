import type { Language } from "@/types/languages";
import type { UserPreferences } from "@/types/preferences";

type TitleLanguages = {
  audioLanguages: Language[];
  audioMandatory: boolean;
  subtitleLanguages: Language[];
};

export type EffectiveLanguages = {
  audioLanguages: Language[];
  audioMandatory: boolean;
  subtitleLanguages: Language[];
  audioInherited: boolean;
  subtitlesInherited: boolean;
};

export function effectiveLanguages(
  title: TitleLanguages,
  preferences: UserPreferences | null,
): EffectiveLanguages {
  const audioInherited =
    preferences !== null && title.audioLanguages.length === 0;
  const subtitlesInherited =
    preferences !== null && title.subtitleLanguages.length === 0;
  return {
    audioLanguages: audioInherited
      ? (preferences as UserPreferences).audioLanguages
      : title.audioLanguages,
    audioMandatory: audioInherited
      ? (preferences as UserPreferences).audioMandatory
      : title.audioMandatory,
    subtitleLanguages: subtitlesInherited
      ? (preferences as UserPreferences).subtitleLanguages
      : title.subtitleLanguages,
    audioInherited,
    subtitlesInherited,
  };
}
