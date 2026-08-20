import Link from "next/link";
import { getTranslations } from "next-intl/server";

export default async function MovieNotFound() {
  const t = await getTranslations("notFound");

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">
          {t("title")}
        </h2>
      </div>
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6">
        <div className="space-y-6 text-center">
          <p className="text-gray-700 dark:text-gray-300">{t("message")}</p>
          <Link
            href="/movies"
            className="inline-flex items-center justify-center rounded-lg bg-white px-5 py-3.5 text-sm font-medium text-gray-700 shadow-theme-xs ring-1 ring-inset ring-gray-300 transition hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-400 dark:ring-gray-700 dark:hover:bg-white/[0.03] dark:hover:text-gray-300"
          >
            {t("backToMovies")}
          </Link>
        </div>
      </div>
    </div>
  );
}
