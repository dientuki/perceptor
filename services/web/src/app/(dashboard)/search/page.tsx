import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  getMediaCapabilities,
  searchAllMedia,
  searchMediaForPage,
} from "@/actions/media";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { MultiSearchResults } from "@/components/search/MultiSearchResults";
import { MEDIA_TYPE } from "@/types/media";
import type { MediaSearchResult } from "@/types/search";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pages.search");

  return {
    title: t("metadataTitle"),
    description: t("metadataDescription"),
  };
}

interface SearchPageProps {
  searchParams: Promise<{ q?: string | string[] }>;
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const t = await getTranslations("pages.search");
  const tContainer = await getTranslations("search.container");
  const params = await searchParams;
  const rawQuery = params.q;
  const query = (Array.isArray(rawQuery) ? rawQuery[0] : rawQuery) ?? "";
  const searched = query.trim().length > 0;

  const { moviesEnabled, showsEnabled, shortsEnabled } =
    await getMediaCapabilities();

  if (!moviesEnabled && !showsEnabled) {
    return (
      <div>
        <PageBreadcrumb pageTitle={t("title")} />
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6">
          <p className="text-gray-500 dark:text-gray-400">
            {tContainer("unavailable")}
          </p>
        </div>
      </div>
    );
  }

  let results: MediaSearchResult[] = [];
  let error: string | null = null;

  try {
    if (moviesEnabled && showsEnabled) {
      results = await searchAllMedia(query);
    } else {
      const type = moviesEnabled ? MEDIA_TYPE.MOVIE : MEDIA_TYPE.SHOW;
      results = await searchMediaForPage(query, type);
    }
  } catch (err) {
    // redirectToClearSession (inside searchAllMedia/searchMediaForPage) throws
    // Next's internal redirect error on an auth failure — it must propagate,
    // not be treated as a search error.
    unstable_rethrow(err);
    console.error("Error al buscar:", err);
    // Both actions already ran the raw GraphQL error through
    // translateGraphQLError before throwing.
    error = err instanceof Error ? err.message : String(err);
  }

  return (
    <div>
      <PageBreadcrumb pageTitle={t("title")} />
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6">
        <MultiSearchResults
          results={results}
          searched={searched}
          initialError={error}
          shortsEnabled={shortsEnabled}
        />
      </div>
    </div>
  );
}
