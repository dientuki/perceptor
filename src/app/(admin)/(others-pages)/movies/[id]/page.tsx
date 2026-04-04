import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { getMovieById } from "@/models/movies.model";
import { Metadata } from "next";
import { notFound } from "next/navigation";
import Movie from "@/components/movies/movie";
import SearchTorrent from "@/components/search/SearchTorrent";
import { MediaType } from "@prisma/client";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const movie = await getMovieById(Number(id));

  return {
    title: movie ? `${movie.title} | Perceptor` : "Movie Not Found",
    description: movie?.overview || "Movie details page",
  };
}

export default async function MovieDetailsPage({ params }: PageProps) {
  const { id } = await params;
  const movie = await getMovieById(Number(id));

  if (!movie) {
    notFound();
  }

  return (
    <div>
      <PageBreadcrumb pageTitle={movie.title} />
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6">
        <div className="space-y-6">
          <Movie movie={movie}/>
          <SearchTorrent item={movie} mediaType={MediaType.MOVIE}/>
        </div>
      </div>
    </div>
  );
}
