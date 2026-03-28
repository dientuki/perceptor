import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { Metadata } from "next";
import { getAllMovies } from "@/models/movies.model";
import { MediaList } from "@/components/media/MediaList";
import { MediaSearchResult } from "@/search/types";
import { MEDIA_TYPE } from "@/types/media";

export const metadata: Metadata = {
  title: "Movies | Perceptor",
  description: "List of tracked shows",
};

export default async function MoviesPage() {
  const movies = await getAllMovies();

  const items: MediaSearchResult[] = movies.map((movie) => ({
    id: movie.id,
    title: movie.title,
    releaseDate: movie.releaseDate ? new Date(movie.releaseDate).toISOString() : "",
    overview: movie.overview || "",
    posterUrl: movie.posterUrl,
    type: MEDIA_TYPE.MOVIE,
    originalLanguage: movie.originalLanguage || "en",
    showLink: true,
  }));

  return (
    <div>
      <PageBreadcrumb pageTitle="Movies" />
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6">
        <div className="space-y-6">
          <MediaList items={items} />
        </div>
      </div>
    </div>
  );
}
