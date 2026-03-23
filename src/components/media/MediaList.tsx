// components/Media/MediaList.tsx
import { MediaSearchResult } from "@/search/types";
import { MediaCard } from "./MediaCard";

interface MediaListProps {
  items: MediaSearchResult[];
  renderAction?: (item: MediaSearchResult) => React.ReactNode;
  emptyMessage?: string;
}

export function MediaList({ items, renderAction, emptyMessage = "No hay resultados" }: MediaListProps) {
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
        <MediaCard key={item.id} item={item} renderAction={renderAction} />
      ))}
    </div>
  );
}