import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/actions/auth";
import { getLanguages } from "@/actions/languages";
import { getPreferences, getTorrentGroups } from "@/actions/preferences";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import PreferencesForm from "@/components/preferences/PreferencesForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pages.preferences");

  return {
    title: t("metadataTitle"),
    description: t("metadataDescription"),
  };
}

// No isAdmin check and no notFound() — every signed-in user, administrator
// or not, must land here in full (REQ-2, AC-2b). All four reads are
// independent of one another, so they run in a single Promise.all rather
// than the sequential pattern users/page.tsx and settings/page.tsx use to
// guard an admin-only read.
export default async function PreferencesPage() {
  const t = await getTranslations("pages.preferences");

  const [user, preferences, languages, torrentGroups] = await Promise.all([
    getCurrentUser(),
    getPreferences(),
    getLanguages(),
    getTorrentGroups(),
  ]);

  return (
    <div>
      <PageBreadcrumb pageTitle={t("title")} />
      <div className="space-y-6">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6">
          <PreferencesForm
            currentLocale={user.uiLocale}
            preferences={preferences}
            languages={languages}
            torrentGroups={torrentGroups}
          />
        </div>
      </div>
    </div>
  );
}
