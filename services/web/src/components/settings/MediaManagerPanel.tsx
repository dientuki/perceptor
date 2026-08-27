"use client";

import { useTranslations } from "next-intl";
import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import CheckboxField from "@/components/settings/CheckboxField";
import PathPicker from "@/components/settings/PathPicker";
import type { MediaRoot } from "@/types/media-roots";

interface MediaManagerPanelProps {
  moviesFolder: string;
  showsFolder: string;
  moviesEnabled: boolean;
  showsEnabled: boolean;
  libraryRoot: MediaRoot;
  movieDbApiKey: string;
}

// Media Manager tab (REQ-2): movies/series folders and the two
// enable/disable toggles — moved verbatim out of the old single-column form,
// with the hand-rolled <input type="checkbox"> replaced by
// components/form/input/Checkbox.tsx (REQ-4). The TMDB API key isn't named
// by REQ-2's per-tab list (spec.md), but it was part of the old
// "movies and series" section this tab replaces and has nowhere else to
// go — kept here rather than dropped.
export default function MediaManagerPanel({
  moviesFolder,
  showsFolder,
  moviesEnabled,
  showsEnabled,
  libraryRoot,
  movieDbApiKey,
}: MediaManagerPanelProps) {
  const t = useTranslations("settings.form");

  return (
    <div className="space-y-6">
      <div>
        <Label htmlFor="movie_db_api_key">{t("tmdbApiKeyLabel")}</Label>
        <Input
          id="movie_db_api_key"
          name="movie_db_api_key"
          type="password"
          defaultValue={movieDbApiKey}
        />
      </div>

      <CheckboxField
        name="movies_enabled"
        label={t("moviesEnabledLabel")}
        defaultChecked={moviesEnabled}
      />

      <PathPicker
        settingKey="path_movies"
        label={t("moviesFolderLabel")}
        root={libraryRoot}
        value={moviesFolder}
      />

      <CheckboxField
        name="shows_enabled"
        label={t("showsEnabledLabel")}
        defaultChecked={showsEnabled}
      />

      <PathPicker
        settingKey="path_shows"
        label={t("showsFolderLabel")}
        root={libraryRoot}
        value={showsFolder}
      />
    </div>
  );
}
