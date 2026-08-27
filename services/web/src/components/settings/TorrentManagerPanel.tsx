"use client";

import { useTranslations } from "next-intl";
import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import PathPicker from "@/components/settings/PathPicker";
import type { MediaRoot } from "@/types/media-roots";

interface TorrentManagerPanelProps {
  downloadsFolder: string;
  trackerApiKey: string;
  downloadsRoot: MediaRoot;
}

// Torrent Manager tab (REQ-2): downloads folder + indexer API key.
export default function TorrentManagerPanel({
  downloadsFolder,
  trackerApiKey,
  downloadsRoot,
}: TorrentManagerPanelProps) {
  const t = useTranslations("settings.form");

  return (
    <div className="space-y-6">
      <PathPicker
        settingKey="path_downloads"
        label={t("downloadsFolderLabel")}
        root={downloadsRoot}
        value={downloadsFolder}
      />

      <div>
        <Label htmlFor="tracker_api_key">{t("indexerApiKeyLabel")}</Label>
        <Input
          id="tracker_api_key"
          name="tracker_api_key"
          type="password"
          defaultValue={trackerApiKey}
        />
      </div>
    </div>
  );
}
