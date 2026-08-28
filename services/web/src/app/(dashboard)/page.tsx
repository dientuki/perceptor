import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getPopularMedia } from "@/actions/media";
import { PopularCarousel } from "@/components/billboard/PopularCarousel";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import type { MediaSearchResult } from "@/types/search";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pages.billboard");

  return {
    title: t("metadataTitle"),
    description: t("metadataDescription"),
  };
}

export default async function BillboardPage() {
  const t = await getTranslations("pages.billboard");
  const b = await getTranslations("billboard");

  const [moviesResult, showsResult] = await Promise.allSettled([
    getPopularMedia("movie"),
    getPopularMedia("show"),
  ]);

  // redirectToClearSession (inside getPopularMedia) throws Next's internal
  // redirect error on an auth failure. Promise.allSettled swallows any
  // rejection into a settled "rejected" result, so a stale session would
  // otherwise land on a permanent error page instead of bouncing to /login —
  // unstable_rethrow must run on every rejection before it is treated as a
  // catalog failure.
  for (const result of [moviesResult, showsResult]) {
    if (result.status === "rejected") {
      unstable_rethrow(result.reason);
    }
  }

  const movies: MediaSearchResult[] =
    moviesResult.status === "fulfilled" ? moviesResult.value : [];
  const moviesError =
    moviesResult.status === "rejected"
      ? moviesResult.reason instanceof Error
        ? moviesResult.reason.message
        : String(moviesResult.reason)
      : null;

  const shows: MediaSearchResult[] =
    showsResult.status === "fulfilled" ? showsResult.value : [];
  const showsError =
    showsResult.status === "rejected"
      ? showsResult.reason instanceof Error
        ? showsResult.reason.message
        : String(showsResult.reason)
      : null;

  return (
    <div>
      <PageBreadcrumb pageTitle={t("title")} />
      <div className="space-y-8">
        <PopularCarousel
          items={movies}
          heading={b("moviesHeading")}
          initialError={moviesError}
        />
        <PopularCarousel
          items={shows}
          heading={b("showsHeading")}
          initialError={showsError}
        />
      </div>
    </div>
  );
}
