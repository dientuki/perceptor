// components/Media/MediaList.tsx
//import { MediaSearchResult } from "@/search/types";
import { MediaCard } from "./MediaCard";
import { MEDIA_TYPE } from "@/types/media";

interface MediaListProps {
  items: any[];
  renderAction?: (item: any) => React.ReactNode;
  mediaType?: typeof MEDIA_TYPE[keyof typeof MEDIA_TYPE]; // Puedes agregar más tipos si es necesario
  showLink?: boolean; // Nueva propiedad para controlar si se muestra el enlace
  emptyMessage?: string; // Sobreescribe el vacío por defecto ("registradas" no aplica en búsquedas)
}

export function MediaList({
    items,
    renderAction,
    mediaType = MEDIA_TYPE.MOVIE,
    showLink = false,
    emptyMessage
}: MediaListProps) {
  if (items.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-gray-300 dark:border-gray-700">
        <p className="text-gray-500">
          {emptyMessage ?? `No hay ${mediaType === MEDIA_TYPE.MOVIE ? "películas" : "series"} registradas`}
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4">
      {items.map((item) => (
        <MediaCard key={item.id} item={item} renderAction={renderAction} showLink={showLink} />
      ))}
    </div>
  );
}