import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getMediaCapabilities } from "@/actions/media";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import Shorts from "@/components/movies/Shorts";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pages.shorts");

  return {
    title: t("metadataTitle"),
    description: t("metadataDescription"),
  };
}

export default async function ShortsPage() {
  const t = await getTranslations("pages.shorts");
  const capabilities = await getMediaCapabilities();

  if (!capabilities.shortsEnabled) {
    notFound();
  }

  return (
    <div>
      <PageBreadcrumb pageTitle={t("title")} />
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6">
        <div className="space-y-6">
          <Shorts />
        </div>
      </div>
    </div>
  );
}
