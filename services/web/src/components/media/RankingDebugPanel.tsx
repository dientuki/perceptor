import type { Language } from "@/types/languages";
import type { UserPreferences } from "@/types/preferences";

// Debug: the resolution tiers `torrent-ranking.ts`'s `resolution()` recognises, best first —
// static, so it never needs fetching, but it's the first line of "what are we filtering by".
const RESOLUTION_ORDER = ["4K", "1080p", "720p", "480p", "360p"];

interface RankingDebugPanelProps {
  scopeLabel: string;
  preferences: UserPreferences | null;
  effectiveGroups: string[];
  usingGlobalLanguages: boolean;
  effectiveAudioLanguages: Language[];
  effectiveAudioMandatory: boolean;
  usingGlobalSubtitles: boolean;
  effectiveSubtitleLanguages: Language[];
  titleAudioMandatory: boolean;
  titleAudioLanguages: Language[];
  titleSubtitleLanguages: Language[];
}

// Dev-only inspector for the torrent-ranking inputs a title resolves to — not rendered in
// production. Extracted out of Movie.tsx so Show.tsx (or any future detail screen) can mount it
// against its own effective/title values instead of duplicating the JSX.
export default function RankingDebugPanel({
  scopeLabel,
  preferences,
  effectiveGroups,
  usingGlobalLanguages,
  effectiveAudioLanguages,
  effectiveAudioMandatory,
  usingGlobalSubtitles,
  effectiveSubtitleLanguages,
  titleAudioMandatory,
  titleAudioLanguages,
  titleSubtitleLanguages,
}: RankingDebugPanelProps) {
  if (process.env.NODE_ENV === "production") return null;

  return (
    <div className="space-y-1 rounded-lg border border-dashed border-gray-300 p-3 font-mono text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
      <p className="font-semibold text-gray-600 dark:text-gray-300">
        Debug — filtros de ranking, en orden
      </p>
      <p>resolución (orden): {RESOLUTION_ORDER.join(" > ")}</p>
      <p>
        grupos preferidos (scope {scopeLabel}
        {preferences ? "" : ", cargando…"}):{" "}
        {effectiveGroups.join(", ") || "— (usa defaults hardcodeados)"}
      </p>
      <p>
        idiomas de audio — efectivo (
        {usingGlobalLanguages ? "fallback: preferencias globales" : "título"}
        ):{" "}
        {effectiveAudioLanguages.map((l) => `${l.tag}/${l.iso3}`).join(", ") ||
          "—"}
      </p>
      <p>audio obligatorio — efectivo: {String(effectiveAudioMandatory)}</p>
      <p>
        idiomas de subtítulos — efectivo (
        {usingGlobalSubtitles ? "fallback: preferencias globales" : "título"}
        ):{" "}
        {effectiveSubtitleLanguages
          .map((l) => `${l.tag}/${l.iso3}`)
          .join(", ") || "—"}
      </p>
      <p className="pt-1 text-gray-400 dark:text-gray-500">
        título: audioMandatory={String(titleAudioMandatory)}, audioLanguages=
        {titleAudioLanguages.map((l) => `${l.tag}/${l.iso3}`).join(", ") ||
          "—"}
        , subtitleLanguages=
        {titleSubtitleLanguages.map((l) => `${l.tag}/${l.iso3}`).join(", ") ||
          "—"}
      </p>
      <p className="text-gray-400 dark:text-gray-500">
        global (/preferences): audioMandatory=
        {preferences ? String(preferences.audioMandatory) : "…"},
        audioLanguages=
        {preferences
          ? preferences.audioLanguages
              .map((l) => `${l.tag}/${l.iso3}`)
              .join(", ") || "—"
          : "…"}
        , subtitleLanguages=
        {preferences
          ? preferences.subtitleLanguages
              .map((l) => `${l.tag}/${l.iso3}`)
              .join(", ") || "—"
          : "…"}
        , grupos({scopeLabel.toLowerCase()})=
        {effectiveGroups.join(", ") || "—"}
      </p>
    </div>
  );
}
