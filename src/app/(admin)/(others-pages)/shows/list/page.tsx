import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { Metadata } from "next";
import { getAllShows } from "@/models/shows.model";
import { MediaList } from "@/components/media/MediaList";
import { MEDIA_TYPE, MediaSearchResult } from "@/search/types";

export const metadata: Metadata = {
  title: "Shows | Perceptor",
  description: "List of tracked shows",
};

export default async function ShowsPage() {
  const shows = await getAllShows();

  const items: MediaSearchResult[] = shows.map((show) => ({
    id: show.id,
    title: show.title,
    releaseDate: show.releaseDate ? show.releaseDate.toISOString() : undefined,
    description: show.description || "",
    posterUrl: show.posterUrl,
    type: MEDIA_TYPE.TV,
    originalLanguage: show.originalLanguage,
  }));

  return (
    <div>
      <PageBreadcrumb pageTitle="Shows" />
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6">
        <div className="space-y-6">
          <MediaList items={items} />
        </div>
      </div>
    </div>
  );
}
