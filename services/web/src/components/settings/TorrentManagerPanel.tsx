"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  createTorrentGroupAction,
  deleteTorrentGroupAction,
} from "@/actions/preferences";
import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import PathPicker from "@/components/settings/PathPicker";
import Badge from "@/components/ui/badge/Badge";
import type { MediaRoot } from "@/types/media-roots";
import type { TorrentGroup } from "@/types/preferences";

interface TorrentManagerPanelProps {
  downloadsFolder: string;
  trackerApiKey: string;
  downloadsRoot: MediaRoot;
  torrentGroups: TorrentGroup[];
}

// Torrent Manager tab (REQ-2, REQ-8): downloads folder + indexer API key,
// plus the administrator's torrent-group catalog ABM. The group input and
// its badge list are NOT a nested <form> — this panel lives inside the main
// Settings <form> (SettingsForm.tsx), so both the add button's click
// handler and Enter on the input must call preventDefault(), or they submit
// the whole settings screen instead of only adding a group. Local state
// changes only after the server action reports success — never
// optimistically (spec.md § GraphQL Contract Delta).
export default function TorrentManagerPanel({
  downloadsFolder,
  trackerApiKey,
  downloadsRoot,
  torrentGroups,
}: TorrentManagerPanelProps) {
  const t = useTranslations("settings.form");
  const [groups, setGroups] = useState<TorrentGroup[]>(torrentGroups);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleAdd = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    const result = await createTorrentGroupAction(name);
    setPending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setGroups((current) => [...current, result.torrentGroup]);
    setName("");
  };

  const handleRemove = async (id: string) => {
    setError(null);
    const result = await deleteTorrentGroupAction(id);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setGroups((current) => current.filter((group) => group.id !== id));
  };

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

      <div>
        <Label htmlFor="torrent_group_name">{t("groupNameLabel")}</Label>
        <div className="flex gap-2">
          <input
            id="torrent_group_name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAdd();
              }
            }}
            disabled={pending}
            placeholder={t("groupNamePlaceholder")}
            className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30 dark:focus:border-brand-800"
          />
          <button
            type="button"
            disabled={pending}
            onClick={(e) => {
              e.preventDefault();
              handleAdd();
            }}
            className="inline-flex shrink-0 items-center justify-center rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white shadow-theme-xs transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-brand-300"
          >
            {t("addGroup")}
          </button>
        </div>

        {error && <p className="mt-2 text-error-500">{error}</p>}

        {groups.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {groups.map((group) => (
              <Badge
                key={group.id}
                color="primary"
                endIcon={
                  <button
                    type="button"
                    aria-label={t("removeGroup", { name: group.name })}
                    onClick={() => handleRemove(group.id)}
                    className="inline-flex"
                  >
                    <X size={14} />
                  </button>
                }
              >
                {group.name}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
