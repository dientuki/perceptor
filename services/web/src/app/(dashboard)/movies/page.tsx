import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import Movies from "@/components/movies/Movies";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Movies | Perceptor",
  description: "List of tracked movies",
};


export default function MoviesPage() {
  return (
    <div>
      <PageBreadcrumb pageTitle="Movies" />
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6">
        <div className="space-y-6">
          <Movies />
        </div>
      </div>
    </div>
  );
}
