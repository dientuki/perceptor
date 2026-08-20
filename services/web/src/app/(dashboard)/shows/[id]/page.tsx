import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { cache } from "react";
import { getLanguages } from "@/actions/languages";
import { getShowById } from "@/actions/shows";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import SeasonAccordion from "@/components/shows/SeasonAccordion";
import Show from "@/components/shows/Show";

// generateMetadata y la página corren por separado; cache() colapsa los dos fetch en uno solo
const getShow = cache(getShowById);

interface PageProps {
  params: Promise<{ id: string }>;
}

// Parses the route param as a positive integer, or null if it isn't one.
// Must run before any fetch — a NaN sent to the API as an Int! comes back
// as a non-auth GraphQL error that getShowById doesn't catch.
function parseShowId(id: string): number | null {
  const parsed = Number(id);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id } = await params;
  const showId = parseShowId(id);

  // Metadata for the unavailable path — identical whether the id doesn't
  // exist, belongs to another user, or fails validation. Carries no
  // show-derived text.
  const tNotFound = await getTranslations("notFound");
  const unavailableMetadata: Metadata = {
    title: tNotFound("metadataTitle"),
    description: tNotFound("message"),
  };

  if (showId === null) {
    return unavailableMetadata;
  }

  const show = await getShow(showId);

  if (!show) {
    return unavailableMetadata;
  }

  const t = await getTranslations("pages.showDetail");

  return {
    title: `${show.title} | Perceptor`,
    description: show.overview || t("metadataDescription"),
  };
}

export default async function ShowDetailsPage({ params }: PageProps) {
  const { id } = await params;
  const showId = parseShowId(id);

  if (showId === null) {
    notFound();
  }

  const [show, languageOptions] = await Promise.all([
    getShow(showId),
    getLanguages(),
  ]);

  if (!show) {
    notFound();
  }

  const seasons = show.seasons ?? [];
  const lastSeasonNumber = Math.max(...seasons.map((s) => s.seasonNumber));
  // Display order only — newest season first. Episodes within a season and
  // the underlying seasons array both stay in the order the API sent them.
  const seasonsNewestFirst = [...seasons].reverse();

  return (
    <div>
      <PageBreadcrumb pageTitle={show.title} />
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6">
        <div className="space-y-6">
          <Show show={show} languageOptions={languageOptions} />
        </div>
      </div>
      <div className="mt-6 space-y-4">
        {seasonsNewestFirst.map((season) => (
          <SeasonAccordion
            key={season.id}
            season={season}
            defaultOpen={season.seasonNumber === lastSeasonNumber}
            showTitle={show.title}
          />
        ))}
      </div>
    </div>
  );
}
