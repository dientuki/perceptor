import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getDownloads } from "@/actions/downloads";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import DownloadsPanel from "@/components/downloads/DownloadsPanel";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pages.downloads");

  return {
    title: t("metadataTitle"),
    description: t("metadataDescription"),
  };
}

export default async function DownloadsPage() {
  const t = await getTranslations("pages.downloads");
  const tPanel = await getTranslations("downloads.panel");
  const downloads = await getDownloads();

  return (
    <div>
      <PageBreadcrumb pageTitle={t("title")} />
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6">
        <DownloadsPanel
          downloads={downloads}
          grouped
          emptyText={tPanel("emptyAll")}
        />
      </div>
    </div>
  );
}
