import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { searchAllMedia } from "@/actions/media";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { MultiSearchResults } from "@/components/search/MultiSearchResults";
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
  const params = await searchParams;
  const rawQuery = params.q;
  const query = (Array.isArray(rawQuery) ? rawQuery[0] : rawQuery) ?? "";
  const searched = query.trim().length > 0;

  let results: MediaSearchResult[] = [];
  let error: string | null = null;

  try {
    results = await searchAllMedia(query);
  } catch (err) {
    // redirectToClearSession (inside searchAllMedia) throws Next's internal
    // redirect error on an auth failure — it must propagate, not be treated
    // as a search error.
    unstable_rethrow(err);
    console.error("Error al buscar:", err);
    // searchAllMedia already ran the raw GraphQL error through
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
        />
      </div>
    </div>
  );
}
