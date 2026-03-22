import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { getShowById } from "@/models/shows.model";
import { Metadata } from "next";
import { notFound } from "next/navigation";
import { SeasonAccordion } from "@/components/shows/SeasonAccordion";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const show = await getShowById(Number(id));

  return {
    title: show ? `${show.title} | Perceptor` : "Show Not Found",
    description: show?.overview || "Show details page",
  };
}

export default async function ShowDetailsPage({ params }: PageProps) {
  const { id } = await params;
  const show = await getShowById(Number(id));

  if (!show) {
    notFound();
  }

  return (
    <div>
      <PageBreadcrumb pageTitle={show.title} />
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6">
        <h3 className="mb-5 text-lg font-semibold text-gray-800 dark:text-white/90 lg:mb-7">
          {show.title}
        </h3>
        <div className="space-y-6">
          {show.seasons.map((season, index) => (
            <SeasonAccordion 
              key={season.id} 
              season={season} 
              defaultOpen={index === 0} 
            />
          ))}
        </div>
      </div>
    </div>
  );
}
