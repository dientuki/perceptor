import type { Metadata } from "next";
import { getCurrentUser } from "@/actions/auth";
import { getLanguages } from "@/actions/languages";
import { getMediaRoots } from "@/actions/media-roots";
import { getMediaServerOptions } from "@/actions/media-server";
import { getSettings } from "@/actions/settings";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import PreferredLanguagesCard from "@/components/settings/PreferredLanguagesCard";
import SettingsForm from "@/components/settings/SettingsForm";

export const metadata: Metadata = {
  title: "Settings | Perceptor",
  description: "Configuración de rutas y servicios",
};

export default async function SettingsPage() {
  const [settings, mediaRoots, mediaServerOptions, languages, currentUser] =
    await Promise.all([
      getSettings(),
      getMediaRoots(),
      getMediaServerOptions(),
      getLanguages(),
      getCurrentUser(),
    ]);

  return (
    <div>
      <PageBreadcrumb pageTitle="Settings" />
      <div className="space-y-6">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6">
          <div className="space-y-6">
            <SettingsForm
              settings={settings}
              mediaRoots={mediaRoots}
              mediaServerOptions={mediaServerOptions}
            />
          </div>
        </div>

        <PreferredLanguagesCard
          options={languages}
          selected={currentUser.preferredLanguages}
        />
      </div>
    </div>
  );
}
