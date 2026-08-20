import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import Movies from "@/components/movies/Movies";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pages.movies");

  return {
    title: t("metadataTitle"),
    description: t("metadataDescription"),
  };
}

export default async function MoviesPage() {
  const t = await getTranslations("pages.movies");

  return (
    <div>
      <PageBreadcrumb pageTitle={t("title")} />
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6">
        <div className="space-y-6">
          <Movies />
        </div>
      </div>
    </div>
  );
}
