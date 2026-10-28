"use client";

import { MediaCard } from "@/components/media/MediaCard";
import { MEDIA_TYPE } from "@/types/media";
import type { TmdbListDetail } from "@/types/preferences";

interface ListTitlesProps {
  list: TmdbListDetail;
  locale: string;
  emptyMessage: string;
}

// Spec 109, REQ-14
export default function ListTitles({
  list,
  locale,
  emptyMessage,
}: ListTitlesProps) {
  const items = [
    ...list.movies.map((movie) => ({ ...movie, type: MEDIA_TYPE.MOVIE })),
    ...list.shows.map((show) => ({ ...show, type: MEDIA_TYPE.SHOW })),
  ].sort((a, b) => a.title.localeCompare(b.title, locale));

  if (items.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-gray-300 dark:border-gray-700">
        <p className="text-gray-500">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4">
      {items.map((item) => (
        <MediaCard
          key={`${item.type}-${item.id}`}
          item={item}
          showLink
          mediaType={item.type}
          showTypeBadge
          showShortBadge
          showPossession
        />
      ))}
    </div>
  );
}
