"use client";
import { FileVideo, Magnet } from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import {
  setMovieAudioMandatoryAction,
  setMoviePreferredTrackLanguagesAction,
} from "@/actions/languages";
import type { Movie as MovieRecord } from "@/actions/movies";
import { setMovieShortAction } from "@/actions/movies";
import { getPreferences } from "@/actions/preferences";
import Switch from "@/components/form/switch/Switch";
import ImportFileModal from "@/components/import/importFileModal";
import ImportMagnetModal from "@/components/import/importMagnetModal";
import TitleLanguagesForm from "@/components/media/TitleLanguagesForm";
import StatusBadge from "@/components/status/StatusBadge";
import Button from "@/components/ui/button/Button";
import { useModal } from "@/hooks/useModal";
import type { Language } from "@/types/languages";
import type { AcquisitionTarget } from "@/types/media";
import type { UserPreferences } from "@/types/preferences";

// Debug: the resolution tiers `torrent-ranking.ts`'s `resolution()` recognises, best first —
// static, so it never needs fetching, but it's the first line of "what are we filtering by".
const RESOLUTION_ORDER = ["4K", "1080p", "720p", "480p", "360p"];

export default function Movie({
  movie,
  languageOptions,
  shortsEnabled,
}: {
  movie: MovieRecord;
  languageOptions: Language[];
  shortsEnabled: boolean;
}) {
  const t = useTranslations("movies.detail");
  const [isShort, setIsShort] = useState(movie.isShort);
  const [shortSwitchKey, setShortSwitchKey] = useState(0);
  const [shortError, setShortError] = useState<string | null>(null);
  const [isShortPending, startShortTransition] = useTransition();
  const {
    isOpen: isFileModalOpen,
    openModal: openFileModal,
    closeModal: closeFileModal,
  } = useModal();
  const {
    isOpen: isMagnetModalOpen,
    openModal: openMagnetModal,
    closeModal: closeMagnetModal,
  } = useModal();
  const target: AcquisitionTarget = { kind: "movie", movie };

  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  useEffect(() => {
    getPreferences()
      .then(setPreferences)
      .catch(() => setPreferences(null));
  }, []);

  // Same merge SearchTorrent.tsx does before ranking: a title with no languages of its own falls
  // back to the caller's global /preferences instead of ranking unarmed.
  const usingGlobalLanguages = movie.audioLanguages.length === 0;
  const effectiveAudioMandatory =
    usingGlobalLanguages && preferences
      ? preferences.audioMandatory
      : movie.audioMandatory;
  const effectiveAudioLanguages =
    usingGlobalLanguages && preferences
      ? preferences.audioLanguages
      : movie.audioLanguages;
  const effectiveGroups = preferences
    ? preferences.movieTorrentGroups.map((g) => g.name)
    : [];
  const usingGlobalSubtitles = movie.subtitleLanguages.length === 0;
  const effectiveSubtitleLanguages =
    usingGlobalSubtitles && preferences
      ? preferences.subtitleLanguages
      : movie.subtitleLanguages;
  const setMovieAudioLanguages = setMoviePreferredTrackLanguagesAction.bind(
    null,
    movie.id,
    "AUDIO",
  );
  const setMovieSubtitleLanguages = setMoviePreferredTrackLanguagesAction.bind(
    null,
    movie.id,
    "SUBTITLE",
  );
  const setMovieAudioMandatory = setMovieAudioMandatoryAction.bind(
    null,
    movie.id,
  );

  // The Switch component owns its own display state internally
  // (defaultChecked, not a controlled `checked`), so reverting it on a
  // server refusal means remounting it with the previous value rather than
  // re-rendering with a new prop — the same reason PathPicker et al. use a
  // raw controlled input instead. shortSwitchKey forces that remount.
  const handleShortToggle = (checked: boolean) => {
    setShortError(null);
    startShortTransition(async () => {
      const result = await setMovieShortAction(movie.id, checked);
      if ("error" in result) {
        setShortError(result.error);
        setShortSwitchKey((key) => key + 1);
        return;
      }
      setIsShort(checked);
    });
  };

  return (
    <div className="flex flex-col gap-8 md:flex-row">
      {/* Poster a la izquierda */}
      <div className="w-full shrink-0 md:w-64 lg:w-72">
        {movie.posterUrl ? (
          // El posterUrl del api es w300 (300px de ancho); pedir más grande lo escala y se ve borroso
          <Image
            src={movie.posterUrl}
            alt={movie.title}
            width={300}
            height={450}
            className="rounded-xl shadow-md"
            priority
          />
        ) : (
          <div className="flex aspect-[2/3] items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-800">
            <span className="text-gray-400 italic">{t("noPoster")}</span>
          </div>
        )}
      </div>

      {/* Información a la derecha */}
      <div className="flex-1 space-y-6">
        <div>
          <h3 className="mb-2 text-2xl font-bold text-gray-800 dark:text-white/90">
            {movie.title}
          </h3>
          <p className="text-gray-500 dark:text-gray-400">
            {movie.releaseDate
              ? new Date(movie.releaseDate).getFullYear()
              : t("unknownYear")}{" "}
            • {movie.originalLanguage.toUpperCase()} •{" "}
            <StatusBadge status={movie.status} />
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button size="sm" variant="outline" onClick={openFileModal}>
            <FileVideo size={18} />
            {t("fileButton")}
          </Button>
          <Button size="sm" variant="outline" onClick={openMagnetModal}>
            <Magnet size={18} className="text-red-500" />
            {t("magnetButton")}
          </Button>
        </div>

        {shortsEnabled && (
          <div className="space-y-1">
            <Switch
              key={shortSwitchKey}
              label={t("shortLabel")}
              defaultChecked={isShort}
              disabled={isShortPending}
              onChange={handleShortToggle}
            />
            {shortError && <p className="text-error-500">{shortError}</p>}
          </div>
        )}

        <div className="space-y-2">
          <h4 className="font-semibold uppercase tracking-wider text-gray-400">
            {t("synopsisTitle")}
          </h4>
          <p className="text-gray-600 dark:text-gray-300 leading-relaxed italic">
            {movie.overview || t("noOverview")}
          </p>
        </div>

        <div className="space-y-1 rounded-lg border border-dashed border-gray-300 p-3 font-mono text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
          <p className="font-semibold text-gray-600 dark:text-gray-300">
            Debug — filtros de ranking, en orden
          </p>
          <p>resolución (orden): {RESOLUTION_ORDER.join(" > ")}</p>
          <p>
            grupos preferidos (scope MOVIE
            {preferences ? "" : ", cargando…"}):{" "}
            {effectiveGroups.join(", ") || "— (usa defaults hardcodeados)"}
          </p>
          <p>
            idiomas de audio — efectivo (
            {usingGlobalLanguages
              ? "fallback: preferencias globales"
              : "título"}
            ):{" "}
            {effectiveAudioLanguages
              .map((l) => `${l.tag}/${l.iso3}`)
              .join(", ") || "—"}
          </p>
          <p>audio obligatorio — efectivo: {String(effectiveAudioMandatory)}</p>
          <p>
            idiomas de subtítulos — efectivo (
            {usingGlobalSubtitles
              ? "fallback: preferencias globales"
              : "título"}
            ):{" "}
            {effectiveSubtitleLanguages
              .map((l) => `${l.tag}/${l.iso3}`)
              .join(", ") || "—"}
          </p>
          <p className="pt-1 text-gray-400 dark:text-gray-500">
            título: audioMandatory={String(movie.audioMandatory)},
            audioLanguages=
            {movie.audioLanguages.map((l) => `${l.tag}/${l.iso3}`).join(", ") ||
              "—"}
            , subtitleLanguages=
            {movie.subtitleLanguages
              .map((l) => `${l.tag}/${l.iso3}`)
              .join(", ") || "—"}
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
            , grupos(movie)=
            {preferences
              ? preferences.movieTorrentGroups.map((g) => g.name).join(", ") ||
                "—"
              : "…"}
          </p>
        </div>

        <div className="space-y-2 max-w-lg">
          <h4 className="font-semibold uppercase tracking-wider text-gray-400">
            {t("languagesTitle")}
          </h4>
          <TitleLanguagesForm
            options={languageOptions}
            audioSelected={movie.audioLanguages}
            subtitleSelected={movie.subtitleLanguages}
            audioMandatory={movie.audioMandatory}
            setAudioAction={setMovieAudioLanguages}
            setSubtitleAction={setMovieSubtitleLanguages}
            setAudioMandatoryAction={setMovieAudioMandatory}
          />
        </div>
      </div>

      <ImportFileModal
        isOpen={isFileModalOpen}
        onClose={closeFileModal}
        target={target}
      />
      <ImportMagnetModal
        isOpen={isMagnetModalOpen}
        onClose={closeMagnetModal}
        target={target}
      />
    </div>
  );
}
