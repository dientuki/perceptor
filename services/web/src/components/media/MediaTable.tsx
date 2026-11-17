"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { LibraryMovie, LibraryShow } from "@/actions/library";
import LanguageChips from "@/components/media/LanguageChips";
import StatusBadge from "@/components/status/StatusBadge";
import { MEDIA_TYPE, type MediaType } from "@/types/media";

type Props = {
  items: (LibraryMovie | LibraryShow)[];
  mediaType: MediaType;
};

function releaseYear(releaseDate: string | null | undefined): string {
  if (!releaseDate) return "—";
  const date = new Date(releaseDate);
  return Number.isNaN(date.getTime()) ? "—" : String(date.getUTCFullYear());
}

export default function MediaTable({ items, mediaType }: Props) {
  const t = useTranslations("media.library");
  const basePath = mediaType === MEDIA_TYPE.SHOW ? "/shows" : "/movies";

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
      <table className="w-full table-fixed text-left">
        <thead className="border-b border-gray-200 text-theme-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
          <tr>
            <th className="w-20 px-4 py-3 font-medium">{t("column.year")}</th>
            <th className="min-w-64 px-4 py-3 font-medium">
              {t("column.title")}
            </th>
            <th className="w-40 px-4 py-3 font-medium">{t("column.audio")}</th>
            <th className="w-40 px-4 py-3 font-medium">
              {t("column.subtitles")}
            </th>
            <th className="w-40 px-4 py-3 font-medium">{t("column.status")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
          {items.map((item) => (
            <tr key={item.id}>
              <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                {releaseYear(item.releaseDate)}
              </td>
              <td className="min-w-0 px-4 py-3">
                <Link
                  href={`${basePath}/${item.id}`}
                  className="block truncate font-medium text-gray-800 hover:text-brand-500 dark:text-white/90"
                >
                  {item.title}
                </Link>
                {item.overview ? (
                  <p className="min-w-0 truncate text-gray-500 dark:text-gray-400">
                    {item.overview}
                  </p>
                ) : null}
              </td>
              <td className="px-4 py-3">
                <LanguageChips
                  codes={item.fileAudioLanguages ?? null}
                  variant="compact"
                />
              </td>
              <td className="px-4 py-3">
                <LanguageChips
                  codes={item.fileSubtitleLanguages ?? null}
                  variant="compact"
                />
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={item.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
