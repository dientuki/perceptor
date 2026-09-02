"use client";

import { Cloud, FolderTree, Globe, Server, Sliders } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { updateSettingsAction } from "@/actions/settings";
import CompressionPanel from "@/components/settings/CompressionPanel";
import GeneralPanel from "@/components/settings/GeneralPanel";
import MediaManagerPanel from "@/components/settings/MediaManagerPanel";
import MediaServerFields from "@/components/settings/MediaServerFields";
import TorrentManagerPanel from "@/components/settings/TorrentManagerPanel";
import Button from "@/components/ui/button/Button";
import TabNav, { type TabNavItem } from "@/components/ui/tabs/TabNav";
import type { MediaRoot } from "@/types/media-roots";
import type {
  MediaServerIndexStatus,
  MediaServerOption,
} from "@/types/media-server";
import type { Setting } from "@/types/settings";

interface SettingsFormProps {
  settings: Setting[];
  mediaRoots: MediaRoot[];
  mediaServerOptions: MediaServerOption[];
  mediaServerIndexStatus: MediaServerIndexStatus;
}

const TABS = [
  "general",
  "mediaManager",
  "mediaServer",
  "torrentManager",
  "compression",
] as const;
type TabKey = (typeof TABS)[number];

// One main <form>, five panels, all mounted at once — inactive ones hidden
// with `className="hidden"` rather than conditionally rendered. FormData
// reads the DOM, so a conditionally rendered panel would drop its fields the
// moment the user leaves that tab, and the save would silently persist only
// a subset (REQ-3, AC-2). This is the one structural rule the main form must
// not violate.
export default function SettingsForm({
  settings,
  mediaRoots,
  mediaServerOptions,
  mediaServerIndexStatus,
}: SettingsFormProps) {
  const t = useTranslations("settings.form");
  const tTabs = useTranslations("settings.tabs");
  const [state, formAction, isPending] = useActionState(
    updateSettingsAction,
    null,
  );
  const [activeTab, setActiveTab] = useState<TabKey>("general");

  const getSettingValue = (key: string) =>
    settings.find((setting) => setting.key === key)?.value ?? "";
  const rootOf = (id: string): MediaRoot =>
    mediaRoots.find((root) => root.id === id) ?? {
      id,
      label: id,
      hostPath: "?",
      available: false,
    };

  const tabItems: TabNavItem[] = [
    { key: "general", label: tTabs("general"), icon: Globe },
    { key: "mediaManager", label: tTabs("mediaManager"), icon: FolderTree },
    { key: "mediaServer", label: tTabs("mediaServer"), icon: Server },
    { key: "torrentManager", label: tTabs("torrentManager"), icon: Cloud },
    { key: "compression", label: tTabs("compression"), icon: Sliders },
  ];

  const panelClass = (key: TabKey) => (key === activeTab ? "" : "hidden");

  return (
    <div>
      <TabNav
        items={tabItems}
        active={activeTab}
        onChange={(key) => setActiveTab(key as TabKey)}
      />

      <form action={formAction}>
        <div className="mt-6 space-y-6">
          <div className={panelClass("general")}>
            <GeneralPanel uiLocale={getSettingValue("ui_locale")} />
          </div>

          <div className={panelClass("mediaManager")}>
            <MediaManagerPanel
              moviesFolder={getSettingValue("path_movies")}
              showsFolder={getSettingValue("path_shows")}
              moviesEnabled={getSettingValue("movies_enabled") === "true"}
              showsEnabled={getSettingValue("shows_enabled") === "true"}
              libraryRoot={rootOf("library")}
              movieDbApiKey={getSettingValue("movie_db_api_key")}
            />
          </div>

          <div className={panelClass("mediaServer")}>
            <MediaServerFields
              options={mediaServerOptions}
              client={getSettingValue("media_server_client")}
              host={getSettingValue("media_server_host")}
              port={getSettingValue("media_server_port")}
              apiKey={getSettingValue("media_server_api_key")}
              indexStatus={mediaServerIndexStatus}
            />
          </div>

          <div className={panelClass("torrentManager")}>
            <TorrentManagerPanel
              downloadsFolder={getSettingValue("path_downloads")}
              trackerApiKey={getSettingValue("tracker_api_key")}
              downloadsRoot={rootOf("downloads")}
            />
          </div>

          <div className={panelClass("compression")}>
            <CompressionPanel
              compressionEnabled={
                getSettingValue("compression_enabled") === "true"
              }
            />
          </div>
        </div>

        {state && "error" in state && state.error && (
          <p className="mt-6 rounded-lg bg-error-50 p-3 text-error-500 dark:bg-error-500/10">
            {state.error}
          </p>
        )}

        {state && "success" in state && state.success && (
          <p className="mt-6 text-success-500">{t("saved")}</p>
        )}

        <div className="mt-6">
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? t("saving") : t("save")}
          </Button>
        </div>
      </form>
    </div>
  );
}
