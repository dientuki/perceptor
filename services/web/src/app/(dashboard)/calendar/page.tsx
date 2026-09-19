import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Calendar from "@/components/calendar/Calendar";
import CalendarLegend from "@/components/calendar/CalendarLegend";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pages.calendar");

  return {
    title: t("metadataTitle"),
    description: t("metadataDescription"),
  };
}

export default async function CalendarPage() {
  const t = await getTranslations("pages.calendar");

  return (
    <div>
      <PageBreadcrumb pageTitle={t("title")} />
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6">
        <div className="space-y-6">
          <CalendarLegend />
          <Calendar />
        </div>
      </div>
    </div>
  );
}
