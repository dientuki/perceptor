import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import TranslateContainer from "@/components/translate/TranslateContainer";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Next.js Blank Page | TailAdmin - Next.js Dashboard Template",
  description: "This is Next.js Blank Page TailAdmin Dashboard Template",
};

export default function ImportPage() {
  return (
    <div>
      <PageBreadcrumb pageTitle="Import Page" />
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6">
        <div className="space-y-6">
          <TranslateContainer />
        </div>
      </div>
    </div>
  );
}
