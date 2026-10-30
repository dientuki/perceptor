import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getMediaCapabilities } from "@/actions/media";
import { getTmdbLists } from "@/actions/tmdb-lists";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import TmdbListsSection from "@/components/lists/TmdbListsSection";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pages.lists");

  return {
    title: t("metadataTitle"),
    description: t("metadataDescription"),
  };
}

// Spec 109, REQ-13
export default async function ListsPage() {
  const t = await getTranslations("pages.lists");

  const [lists, capabilities] = await Promise.all([
    getTmdbLists(),
    getMediaCapabilities(),
  ]);

  return (
    <div>
      <PageBreadcrumb pageTitle={t("title")} />
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6">
        <TmdbListsSection
          lists={lists}
          listImportEnabled={capabilities.listImportEnabled}
        />
      </div>
    </div>
  );
}
