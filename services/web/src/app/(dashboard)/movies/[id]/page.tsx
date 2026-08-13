import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { Metadata } from "next";
import { notFound } from "next/navigation";
import Movie from "@/components/movies/Movie";
import { cache } from "react";
import { getMovieById } from "@/actions/movies";
import SearchTorrent from "@/components/search/SearchTorrent";
import { MEDIA_TYPE } from "@/types/media";

// generateMetadata y la página corren por separado; cache() colapsa los dos fetch en uno solo
const getMovie = cache(getMovieById);

// Metadata for the unavailable path — identical whether the id doesn't exist,
// belongs to another user, or fails validation. Carries no film-derived text.
const UNAVAILABLE_METADATA: Metadata = {
  title: "Recurso no disponible | Perceptor",
  description: "Recurso no disponible para este usuario",
};

interface PageProps {
  params: Promise<{ id: string }>;
}

// Parses the route param as a positive integer, or null if it isn't one.
// Must run before any fetch — a NaN sent to the API as an Int! comes back
// as a non-auth GraphQL error that getMovieById doesn't catch.
function parseMovieId(id: string): number | null {
  const parsed = Number(id);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id } = await params;
  const movieId = parseMovieId(id);

  if (movieId === null) {
    return UNAVAILABLE_METADATA;
  }

  const movie = await getMovie(movieId);

  if (!movie) {
    return UNAVAILABLE_METADATA;
  }

  return {
    title: `${movie.title} | Perceptor`,
    description: movie.overview || "Movie details page",
  };
}

export default async function MovieDetailsPage({ params }: PageProps) {
  const { id } = await params;
  const movieId = parseMovieId(id);

  if (movieId === null) {
    notFound();
  }

  const movie = await getMovie(movieId);

  if (!movie) {
    notFound();
  }

  return (
    <div>
      <PageBreadcrumb pageTitle={movie.title} />
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6">
        <div className="space-y-6">
          <Movie movie={movie} />
          <SearchTorrent item={movie} mediaType={MEDIA_TYPE.MOVIE} />
        </div>
      </div>
    </div>
  );
}
