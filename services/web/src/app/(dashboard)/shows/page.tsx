import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import Shows from "@/components/Shows/Shows";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Shows | Perceptor",
  description: "List of tracked shows",
};


export default function ShowsPage() {
  return (
    <div>
      <PageBreadcrumb pageTitle="Shows" />
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6">
        <div className="space-y-6">
          <Shows />
        </div>
      </div>
    </div>
  );
}
