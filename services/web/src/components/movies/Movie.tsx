"use client";
import { FileVideo, Magnet } from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import {
  setMovieAudioMandatoryAction,
  setMoviePreferredTrackLanguagesAction,
} from "@/actions/languages";
import type { Movie as MovieRecord } from "@/actions/movies";
import {
  refreshMovieAction,
  removeMovieAction,
  setMovieContentKindAction,
  setMovieShortAction,
} from "@/actions/movies";
import Switch from "@/components/form/switch/Switch";
import ImportFileModal from "@/components/import/importFileModal";
import ImportMagnetModal from "@/components/import/importMagnetModal";
import ContentKindSelect from "@/components/media/ContentKindSelect";
import RankingDebugPanel from "@/components/media/RankingDebugPanel";
import RefreshTitleButton from "@/components/media/RefreshTitleButton";
import RemoveTitleButton from "@/components/media/RemoveTitleButton";
import TitleLanguagesPanel from "@/components/media/TitleLanguagesPanel";
import StatusBadge from "@/components/status/StatusBadge";
import Button from "@/components/ui/button/Button";
import { useModal } from "@/hooks/useModal";
import { effectiveLanguages } from "@/lib/effective-languages";
import type { Language } from "@/types/languages";
import type { AcquisitionTarget, ContentKind } from "@/types/media";
import type { UserPreferences } from "@/types/preferences";

export default function Movie({
  movie,
  languageOptions,
  shortsEnabled,
  preferences,
}: {
  movie: MovieRecord;
  languageOptions: Language[];
  shortsEnabled: boolean;
  preferences: UserPreferences | null;
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

  const effective = effectiveLanguages(movie, preferences);
  const effectiveGroups = preferences
    ? preferences.movieTorrentGroups.map((g) => g.name)
    : [];
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
  const handleContentKindSave = (kind: ContentKind) =>
    setMovieContentKindAction(Number(movie.id), kind);

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
    <div className="grid grid-cols-1 gap-8 md:grid-cols-[16rem_minmax(0,1fr)_20rem]">
      <div className="min-w-0">
        {movie.posterUrl ? (
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

      <div className="min-w-0 space-y-6">
        <div>
          <h3 className="mb-2 text-2xl font-bold text-gray-800 dark:text-white/90">
            {movie.title}
          </h3>
          <p className="text-gray-500 dark:text-gray-400">
            {movie.releaseDate
              ? new Date(movie.releaseDate).getUTCFullYear()
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

        <div className="space-y-2">
          <h4 className="font-semibold uppercase tracking-wider text-gray-400">
            {t("synopsisTitle")}
          </h4>
          <p className="text-gray-600 dark:text-gray-300 leading-relaxed italic">
            {movie.overview || t("noOverview")}
          </p>
        </div>

        <RankingDebugPanel
          scopeLabel="MOVIE"
          preferences={preferences}
          effectiveGroups={effectiveGroups}
          usingGlobalLanguages={effective.audioInherited}
          effectiveAudioLanguages={effective.audioLanguages}
          effectiveAudioMandatory={effective.audioMandatory}
          usingGlobalSubtitles={effective.subtitlesInherited}
          effectiveSubtitleLanguages={effective.subtitleLanguages}
          titleAudioMandatory={movie.audioMandatory}
          titleAudioLanguages={movie.audioLanguages}
          titleSubtitleLanguages={movie.subtitleLanguages}
        />
      </div>

      <div className="min-w-0 space-y-6">
        <div className="flex flex-wrap gap-3">
          <RefreshTitleButton
            onRefresh={refreshMovieAction.bind(null, movie.id)}
          />
          <RemoveTitleButton
            title={movie.title}
            otherOwners={movie.otherOwners ?? 0}
            hasLibraryFile={movie.status === "COMPLETED"}
            redirectTo={isShort ? "/shorts" : "/movies"}
            onConfirm={removeMovieAction.bind(null, movie.id)}
          />
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

        <ContentKindSelect
          value={movie.contentKind}
          onSave={handleContentKindSave}
          label={t("contentKindLabel")}
        />

        <TitleLanguagesPanel
          effective={effective}
          options={languageOptions}
          audioSelected={movie.audioLanguages}
          subtitleSelected={movie.subtitleLanguages}
          audioMandatory={movie.audioMandatory}
          setAudioAction={setMovieAudioLanguages}
          setSubtitleAction={setMovieSubtitleLanguages}
          setAudioMandatoryAction={setMovieAudioMandatory}
        />
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
