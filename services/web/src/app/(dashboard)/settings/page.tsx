import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/actions/auth";
import { getLanguages } from "@/actions/languages";
import { getMediaRoots } from "@/actions/media-roots";
import { getMediaServerOptions } from "@/actions/media-server";
import { getSettings } from "@/actions/settings";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import PreferredLanguagesCard from "@/components/settings/PreferredLanguagesCard";
import SettingsForm from "@/components/settings/SettingsForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pages.settings");

  return {
    title: t("metadataTitle"),
    description: t("metadataDescription"),
  };
}

export default async function SettingsPage() {
  const t = await getTranslations("pages.settings");
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
      <PageBreadcrumb pageTitle={t("title")} />
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
