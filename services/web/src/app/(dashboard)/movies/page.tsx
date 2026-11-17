import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getMediaCapabilities } from "@/actions/media";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import Movies from "@/components/movies/Movies";
import type { RawSearchParams } from "@/lib/library-params";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pages.movies");

  return {
    title: t("metadataTitle"),
    description: t("metadataDescription"),
  };
}

export default async function MoviesPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const t = await getTranslations("pages.movies");
  const capabilities = await getMediaCapabilities();

  if (!capabilities.moviesEnabled) {
    notFound();
  }

  return (
    <div>
      <PageBreadcrumb pageTitle={t("title")} />
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6">
        <div className="space-y-6">
          <Movies
            isShort={capabilities.shortsEnabled ? false : undefined}
            pathname="/movies"
            searchParams={await searchParams}
          />
        </div>
      </div>
    </div>
  );
}
