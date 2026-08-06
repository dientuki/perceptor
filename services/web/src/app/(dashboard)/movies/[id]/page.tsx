import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { Metadata } from "next";
import { notFound } from "next/navigation";
import Movie from "@/components/movies/Movie";
import { cache } from "react";
import { getMovieById } from "@/actions/movies";

// generateMetadata y la página corren por separado; cache() colapsa los dos fetch en uno solo
const getMovie = cache(getMovieById);

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const movie = await getMovie(Number(id));

  return {
    title: movie ? `${movie.title} | Perceptor` : "Movie Not Found",
    description: movie?.overview || "Movie details page",
  };
}

export default async function MovieDetailsPage({ params }: PageProps) {
  const { id } = await params;
  const movie = await getMovie(Number(id));

  if (!movie) {
    notFound();
  }

  return (
    <div>
      <PageBreadcrumb pageTitle={movie.title} />
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6">
        <div className="space-y-6">
          <Movie movie={movie}/>
          
        </div>
      </div>
    </div>
  );
}
