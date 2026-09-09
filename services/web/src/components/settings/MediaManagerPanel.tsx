"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import Switch from "@/components/form/switch/Switch";
import PathPicker from "@/components/settings/PathPicker";
import type { MediaRoot } from "@/types/media-roots";

interface MediaManagerPanelProps {
  moviesFolder: string;
  showsFolder: string;
  moviesEnabled: boolean;
  showsEnabled: boolean;
  shortsFolder: string;
  shortsEnabled: boolean;
  libraryRoot: MediaRoot;
  movieDbApiKey: string;
}

// Media Manager tab (REQ-2): movies/series folders and the two
// enable/disable toggles — moved verbatim out of the old single-column form,
// with the hand-rolled <input type="checkbox"> replaced by the same
// Switch + hidden-input pairing CompressionPanel uses (REQ-3). Each switch
// also gates its matching PathPicker: while a switch is off, that folder
// input becomes non-editable (REQ-4), but the folder's stored value keeps
// travelling to the server unchanged — PathPicker owns that guarantee, not
// this component. The TMDB API key isn't named by REQ-2's per-tab list
// (spec.md), but it was part of the old "movies and series" section this
// tab replaces and has nowhere else to go — kept here rather than dropped.
export default function MediaManagerPanel({
  moviesFolder,
  showsFolder,
  moviesEnabled,
  showsEnabled,
  shortsFolder,
  shortsEnabled,
  libraryRoot,
  movieDbApiKey,
}: MediaManagerPanelProps) {
  const t = useTranslations("settings.form");
  const [moviesOn, setMoviesOn] = useState(moviesEnabled);
  const [showsOn, setShowsOn] = useState(showsEnabled);
  const [shortsOn, setShortsOn] = useState(shortsEnabled);

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

      <div>
        <Switch
          label={t("moviesEnabledLabel")}
          defaultChecked={moviesEnabled}
          onChange={setMoviesOn}
        />
        <input
          type="hidden"
          name="movies_enabled"
          value={moviesOn ? "true" : "false"}
        />
      </div>

      <PathPicker
        settingKey="path_movies"
        label={t("moviesFolderLabel")}
        root={libraryRoot}
        value={moviesFolder}
        disabled={!moviesOn}
      />

      <div>
        <Switch
          label={t("showsEnabledLabel")}
          defaultChecked={showsEnabled}
          onChange={setShowsOn}
        />
        <input
          type="hidden"
          name="shows_enabled"
          value={showsOn ? "true" : "false"}
        />
      </div>

      <PathPicker
        settingKey="path_shows"
        label={t("showsFolderLabel")}
        root={libraryRoot}
        value={showsFolder}
        disabled={!showsOn}
      />

      <div>
        <Switch
          label={t("shortsEnabledLabel")}
          defaultChecked={shortsEnabled}
          onChange={setShortsOn}
          disabled={!moviesOn}
        />
        <input
          type="hidden"
          name="shorts_enabled"
          value={shortsOn ? "true" : "false"}
        />
      </div>

      <PathPicker
        settingKey="path_shorts"
        label={t("shortsFolderLabel")}
        root={libraryRoot}
        value={shortsFolder}
        disabled={!moviesOn || !shortsOn}
      />
    </div>
  );
}
