import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/actions/auth";
import { getMediaRoots } from "@/actions/media-roots";
import {
  getMediaServerIndexStatus,
  getMediaServerOptions,
} from "@/actions/media-server";
import { getTorrentGroups } from "@/actions/preferences";
import { getScheduledTasks } from "@/actions/scheduler";
import { getSettings } from "@/actions/settings";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
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

  // Deliberately sequential, not Promise.all: getSettings() is admin-only
  // now, and racing it with the isAdmin check below would turn api's
  // AdminGuard refusal into an uncaught 500 instead of a clean 404 — the
  // users/page.tsx precedent.
  const user = await getCurrentUser();

  if (!user.isAdmin) {
    notFound();
  }

  const [
    settings,
    mediaRoots,
    mediaServerOptions,
    mediaServerIndexStatus,
    scheduledTasks,
    torrentGroups,
  ] = await Promise.all([
    getSettings(),
    getMediaRoots(),
    getMediaServerOptions(),
    getMediaServerIndexStatus(),
    getScheduledTasks(),
    getTorrentGroups(),
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
              mediaServerIndexStatus={mediaServerIndexStatus}
              scheduledTasks={scheduledTasks}
              torrentGroups={torrentGroups}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
