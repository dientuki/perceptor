import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getMediaCapabilities, getPopularMedia } from "@/actions/media";
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

  const { moviesEnabled, showsEnabled } = await getMediaCapabilities();

  // Only build a Promise.allSettled entry for an enabled type — a disabled
  // type gets no getPopularMedia call at all (REQ-3), not a call whose
  // result is discarded.
  const jobs: Array<{
    type: "movie" | "show";
    promise: Promise<MediaSearchResult[]>;
  }> = [];
  if (moviesEnabled) {
    jobs.push({ type: "movie", promise: getPopularMedia("movie") });
  }
  if (showsEnabled) {
    jobs.push({ type: "show", promise: getPopularMedia("show") });
  }

  const settled = await Promise.allSettled(jobs.map((job) => job.promise));

  // redirectToClearSession (inside getPopularMedia) throws Next's internal
  // redirect error on an auth failure. Promise.allSettled swallows any
  // rejection into a settled "rejected" result, so a stale session would
  // otherwise land on a permanent error page instead of bouncing to /login —
  // unstable_rethrow must run on every rejection before it is treated as a
  // catalog failure.
  for (const result of settled) {
    if (result.status === "rejected") {
      unstable_rethrow(result.reason);
    }
  }

  const resultByType = new Map<
    "movie" | "show",
    PromiseSettledResult<MediaSearchResult[]>
  >(jobs.map((job, index) => [job.type, settled[index]]));

  const moviesResult = resultByType.get("movie");
  const movies: MediaSearchResult[] =
    moviesResult?.status === "fulfilled" ? moviesResult.value : [];
  const moviesError =
    moviesResult?.status === "rejected"
      ? moviesResult.reason instanceof Error
        ? moviesResult.reason.message
        : String(moviesResult.reason)
      : null;

  const showsResult = resultByType.get("show");
  const shows: MediaSearchResult[] =
    showsResult?.status === "fulfilled" ? showsResult.value : [];
  const showsError =
    showsResult?.status === "rejected"
      ? showsResult.reason instanceof Error
        ? showsResult.reason.message
        : String(showsResult.reason)
      : null;

  return (
    <div>
      <PageBreadcrumb pageTitle={t("title")} />
      {moviesEnabled || showsEnabled ? (
        <div className="space-y-8">
          {moviesEnabled && (
            <PopularCarousel
              items={movies}
              heading={b("moviesHeading")}
              initialError={moviesError}
            />
          )}
          {showsEnabled && (
            <PopularCarousel
              items={shows}
              heading={b("showsHeading")}
              initialError={showsError}
            />
          )}
        </div>
      ) : (
        <p className="text-gray-500 dark:text-gray-400">{b("unavailable")}</p>
      )}
    </div>
  );
}
