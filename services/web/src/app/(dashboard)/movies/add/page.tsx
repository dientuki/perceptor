import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { addMedia, searchMedia } from "@/actions/media";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import SearchContainer from "@/components/search/SearchContainer";
import { MEDIA_TYPE } from "@/types/media";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pages.moviesAdd");

  return {
    title: t("metadataTitle"),
    description: t("metadataDescription"),
  };
}

export default async function ShowAddPage() {
  const t = await getTranslations("pages.moviesAdd");

  return (
    <div>
      <PageBreadcrumb pageTitle={t("title")} />
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6">
        <div className="space-y-6">
          <SearchContainer
            type={MEDIA_TYPE.MOVIE}
            addAction={addMedia}
            searchAction={searchMedia}
          />
        </div>
      </div>
    </div>
  );
}
