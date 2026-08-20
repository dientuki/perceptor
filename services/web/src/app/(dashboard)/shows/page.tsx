import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import Shows from "@/components/shows/Shows";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pages.shows");

  return {
    title: t("metadataTitle"),
    description: t("metadataDescription"),
  };
}

export default async function ShowsPage() {
  const t = await getTranslations("pages.shows");

  return (
    <div>
      <PageBreadcrumb pageTitle={t("title")} />
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6">
        <div className="space-y-6">
          <Shows />
        </div>
      </div>
    </div>
  );
}
