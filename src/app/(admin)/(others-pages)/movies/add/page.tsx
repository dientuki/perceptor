import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import SearchContainer from "@/components/search/SearchContainer";
import { MEDIA_TYPE } from "@/types/media";
import { Metadata } from "next";
import { addMovieAction } from "@/actions/movies";

export const metadata: Metadata = {
  title: "Next.js Blank Page | TailAdmin - Next.js Dashboard Template",
  description: "This is Next.js Blank Page TailAdmin Dashboard Template",
};

export default function ShowAddPage() {
  return (
    <div>
      <PageBreadcrumb pageTitle="Movies Add" />
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6">
        <div className="space-y-6">
          <SearchContainer type={MEDIA_TYPE.MOVIE} addAction={addMovieAction} />
        </div>
      </div>
    </div>
  );
}
