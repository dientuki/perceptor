// components/Media/MediaList.tsx
"use client";

//import { MediaSearchResult } from "@/search/types";
import { useTranslations } from "next-intl";
import { MEDIA_TYPE } from "@/types/media";
import { MediaCard } from "./MediaCard";

interface MediaListProps {
  items: any[];
  renderAction?: (item: any) => React.ReactNode;
  mediaType?: (typeof MEDIA_TYPE)[keyof typeof MEDIA_TYPE]; // Puedes agregar más tipos si es necesario
  showLink?: boolean; // Nueva propiedad para controlar si se muestra el enlace
  emptyMessage?: string; // Sobreescribe el vacío por defecto ("registradas" no aplica en búsquedas)
}

export function MediaList({
  items,
  renderAction,
  mediaType = MEDIA_TYPE.MOVIE,
  showLink = false,
  emptyMessage,
}: MediaListProps) {
  const t = useTranslations("media.list");

  if (items.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-gray-300 dark:border-gray-700">
        <p className="text-gray-500">
          {emptyMessage ??
            t("emptyDefault", {
              noun:
                mediaType === MEDIA_TYPE.MOVIE ? t("movieNoun") : t("showNoun"),
            })}
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4">
      {items.map((item) => (
        <MediaCard
          key={item.id}
          item={item}
          renderAction={renderAction}
          showLink={showLink}
          mediaType={mediaType}
        />
      ))}
    </div>
  );
}
