"use client";

import { Film, Globe, Languages, TvMinimal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState, useTransition } from "react";
import { setUiLocaleAction } from "@/actions/locale";
import {
  setAllowCinemaReleasesAction,
  setAudioMandatoryAction,
  setPreferredTorrentGroupsAction,
  setPreferredTrackLanguagesAction,
} from "@/actions/preferences";
import Checkbox from "@/components/form/input/Checkbox";
import Label from "@/components/form/Label";
import Select from "@/components/form/Select";
import Switch from "@/components/form/switch/Switch";
import LanguagePickerField from "@/components/preferences/LanguagePickerField";
import TorrentGroupPickerField from "@/components/preferences/TorrentGroupPickerField";
import Button from "@/components/ui/button/Button";
import TabNav, { type TabNavItem } from "@/components/ui/tabs/TabNav";
import { SUPPORTED_LOCALES } from "@/i18n/locales";
import type { Language } from "@/types/languages";
import type { MediaCapabilities } from "@/types/media";
import type { TorrentGroup, UserPreferences } from "@/types/preferences";

interface PreferencesFormProps {
  currentLocale: string | null;
  preferences: UserPreferences;
  languages: Language[];
  torrentGroups: TorrentGroup[];
  capabilities: MediaCapabilities;
}

const TABS = ["general", "downloadLanguages", "movies", "shows"] as const;
type TabKey = (typeof TABS)[number];

function tagsFrom(languages: Language[]): string[] {
  return languages.map((language) => language.tag);
}

function idsFrom(groups: TorrentGroup[]) {
  return groups.map((g) => g.id);
}

// One <form>, four panels, all mounted at once and switched with `hidden`
// like SettingsForm.tsx — and, per this feature's own visual-parity request,
// one Guardar button that fires all six mutations together instead of the
// six independent saves REQ-8 originally specified. A partial failure
// reverts only the fields whose mutation failed, leaving the ones that
// succeeded as saved (the transaction boundary is still per-mutation on
// api — this form does not pretend otherwise).
export default function PreferencesForm({
  currentLocale,
  preferences,
  languages,
  torrentGroups,
  capabilities,
}: PreferencesFormProps) {
  const t = useTranslations("preferences.form");
  const tTabs = useTranslations("preferences.tabs");
  const activeLocale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const showMoviesTab = capabilities.moviesEnabled;
  const showShowsTab = capabilities.showsEnabled;
  const [activeTab, setActiveTab] = useState<TabKey>("general");
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);

  const [locale, setLocale] = useState(currentLocale ?? activeLocale);
  const [audioTags, setAudioTags] = useState<string[]>(() =>
    tagsFrom(preferences.audioLanguages),
  );
  const [subtitleTags, setSubtitleTags] = useState<string[]>(() =>
    tagsFrom(preferences.subtitleLanguages),
  );
  const [allowCinemaReleases, setAllowCinemaReleases] = useState(
    preferences.allowCinemaReleases,
  );
  const [audioMandatory, setAudioMandatory] = useState(
    preferences.audioMandatory,
  );
  const [movieGroupIds, setMovieGroupIds] = useState<string[]>(() =>
    idsFrom(preferences.movieTorrentGroups),
  );
  const [showGroupIds, setShowGroupIds] = useState<string[]>(() =>
    idsFrom(preferences.showTorrentGroups),
  );

  const displayNames = useMemo(
    () => new Intl.DisplayNames([activeLocale], { type: "language" }),
    [activeLocale],
  );
  const localeOptions = SUPPORTED_LOCALES.map((code) => ({
    value: code,
    label: displayNames.of(code) ?? code,
  }));

  // The catalog is no longer scoped — both tabs offer the whole thing, and
  // which titles each id applies to is decided by which list it's saved
  // into (movieTorrentGroups vs. showTorrentGroups), not by a per-group tag.
  const movieCatalog = torrentGroups;
  const showCatalog = torrentGroups;

  const tabItems: TabNavItem[] = [
    { key: "general", label: tTabs("general"), icon: Globe },
    {
      key: "downloadLanguages",
      label: tTabs("downloadLanguages"),
      icon: Languages,
    },
    ...(showMoviesTab
      ? [{ key: "movies", label: tTabs("movies"), icon: Film }]
      : []),
    ...(showShowsTab
      ? [{ key: "shows", label: tTabs("shows"), icon: TvMinimal }]
      : []),
  ];

  // The active tab cannot be hidden on first render (capabilities are read
  // server-side before this component mounts), but a `router.refresh()`
  // after toggling a switch in another tab can make it so — fall back to
  // "general" rather than leaving the panel stuck on a tab with no nav item.
  useEffect(() => {
    if (
      (activeTab === "movies" && !showMoviesTab) ||
      (activeTab === "shows" && !showShowsTab)
    ) {
      setActiveTab("general");
    }
  }, [activeTab, showMoviesTab, showShowsTab]);

  const panelClass = (key: TabKey) => (key === activeTab ? "" : "hidden");

  const handleSubmit = () => {
    setErrors([]);
    setSaved(false);

    startTransition(async () => {
      const localeChanged = locale !== (currentLocale ?? activeLocale);

      const localeForm = new FormData();
      localeForm.set("locale", locale);
      const audioForm = new FormData();
      audioForm.set("tags", audioTags.join(","));
      const subtitleForm = new FormData();
      subtitleForm.set("tags", subtitleTags.join(","));
      const movieForm = new FormData();
      movieForm.set("ids", movieGroupIds.join(","));
      const showForm = new FormData();
      showForm.set("ids", showGroupIds.join(","));

      const [
        localeResult,
        audioResult,
        subtitleResult,
        cinemaResult,
        audioMandatoryResult,
        movieResult,
        showResult,
      ] = await Promise.all([
        setUiLocaleAction(null, localeForm),
        setPreferredTrackLanguagesAction("AUDIO", null, audioForm),
        setPreferredTrackLanguagesAction("SUBTITLE", null, subtitleForm),
        setAllowCinemaReleasesAction(allowCinemaReleases),
        setAudioMandatoryAction(audioMandatory),
        showMoviesTab
          ? setPreferredTorrentGroupsAction("MOVIE", null, movieForm)
          : Promise.resolve(null),
        showShowsTab
          ? setPreferredTorrentGroupsAction("SHOW", null, showForm)
          : Promise.resolve(null),
      ]);

      const newErrors: string[] = [];
      if (localeResult && "error" in localeResult && localeResult.error) {
        newErrors.push(localeResult.error);
        setLocale(currentLocale ?? activeLocale);
      }
      if (audioResult && "error" in audioResult && audioResult.error) {
        newErrors.push(audioResult.error);
        setAudioTags(tagsFrom(preferences.audioLanguages));
      }
      if (subtitleResult && "error" in subtitleResult && subtitleResult.error) {
        newErrors.push(subtitleResult.error);
        setSubtitleTags(tagsFrom(preferences.subtitleLanguages));
      }
      if ("error" in cinemaResult && cinemaResult.error) {
        newErrors.push(cinemaResult.error);
        setAllowCinemaReleases(preferences.allowCinemaReleases);
      }
      if (movieResult && "error" in movieResult && movieResult.error) {
        newErrors.push(movieResult.error);
        setMovieGroupIds(idsFrom(preferences.movieTorrentGroups));
      }
      if (showResult && "error" in showResult && showResult.error) {
        newErrors.push(showResult.error);
        setShowGroupIds(idsFrom(preferences.showTorrentGroups));
      }
      if ("error" in audioMandatoryResult && audioMandatoryResult.error) {
        newErrors.push(audioMandatoryResult.error);
        setAudioMandatory(preferences.audioMandatory);
      }

      setErrors(newErrors);
      setSaved(newErrors.length === 0);

      if (localeChanged && !(localeResult && "error" in localeResult)) {
        router.refresh();
      }
    });
  };

  return (
    <div>
      <TabNav
        items={tabItems}
        active={activeTab}
        onChange={(key) => setActiveTab(key as TabKey)}
      />

      <div className="mt-6 space-y-6">
        <div className={panelClass("general")}>
          <div>
            <Label htmlFor="preferences-locale">{t("uiLocaleLabel")}</Label>
            <Select
              id="preferences-locale"
              value={locale}
              options={localeOptions}
              onChange={(event) => setLocale(event.target.value)}
            />
          </div>
        </div>

        <div className={panelClass("downloadLanguages")}>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="space-y-4">
              <LanguagePickerField
                options={languages}
                value={audioTags}
                onChange={setAudioTags}
                label={t("audioLanguagesLabel")}
              />
              <Checkbox
                id="audio-mandatory"
                checked={audioMandatory}
                onChange={setAudioMandatory}
                label={t("audioMandatoryLabel")}
              />
            </div>
            <LanguagePickerField
              options={languages}
              value={subtitleTags}
              onChange={setSubtitleTags}
              label={t("subtitleLanguagesLabel")}
            />
          </div>
        </div>

        <div className={panelClass("movies")}>
          <div className="space-y-6">
            <Switch
              key={`allow-cinema-releases-${allowCinemaReleases}`}
              defaultChecked={allowCinemaReleases}
              onChange={setAllowCinemaReleases}
              label={t("cinemaLabel")}
            />
            {movieCatalog.length === 0 ? (
              <p className="text-gray-500">{t("noneLoaded")}</p>
            ) : (
              <TorrentGroupPickerField
                options={movieCatalog}
                value={movieGroupIds}
                onChange={setMovieGroupIds}
                label={t("movieGroupsLabel")}
              />
            )}
          </div>
        </div>

        <div className={panelClass("shows")}>
          {showCatalog.length === 0 ? (
            <p className="text-gray-500">{t("noneLoaded")}</p>
          ) : (
            <TorrentGroupPickerField
              options={showCatalog}
              value={showGroupIds}
              onChange={setShowGroupIds}
              label={t("showGroupsLabel")}
            />
          )}
        </div>
      </div>

      {errors.length > 0 && (
        <div className="mt-6 space-y-1 rounded-lg bg-error-50 p-3 dark:bg-error-500/10">
          {errors.map((message) => (
            <p key={message} className="text-error-500">
              {message}
            </p>
          ))}
        </div>
      )}

      {saved && <p className="mt-6 text-success-500">{t("saved")}</p>}

      <div className="mt-6">
        <Button size="sm" disabled={isPending} onClick={handleSubmit}>
          {isPending ? t("saving") : t("save")}
        </Button>
      </div>
    </div>
  );
}
