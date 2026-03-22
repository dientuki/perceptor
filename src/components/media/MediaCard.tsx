// components/Media/MediaCard.tsx
import { MediaSearchResult } from "@/search/types";
import { Plus } from "lucide-react";
import Button from "@/components/ui/button/Button";

interface MediaCardProps {
  item: MediaSearchResult;
  renderAction?: (item: MediaSearchResult) => Promise<void> | void;
}

export function MediaCard({ item, renderAction }: MediaCardProps) {
  const year = item.releaseDate ? new Date(item.releaseDate).getFullYear() : "N/A";

  const poster = item.posterUrl ? (
    <img
      src={item.posterUrl}
      alt={item.title}
      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
    />
  ) : (
    <span className="flex h-full items-center justify-center text-xs text-gray-400">Sin Poster</span>
  );

  return (
    <div className="group relative flex flex-col rounded-xl border border-gray-200 bg-white p-2 shadow-sm transition-all hover:shadow-md dark:border-gray-800 dark:bg-white/[0.03]">
      {/* Poster */}
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800">
        {item.showLink ? (
          <a href={item.type === "tv" ? `/shows/${item.id}` : `/movies/${item.id}`} className="block h-full w-full">
            {poster}
          </a>
        ) : (
          poster
        )}
      </div>
      {/* Slot para el Botón (encima del poster o donde prefieras) */}
      {renderAction && (
        <Button size="sm" onClick={() => renderAction(item)} startIcon={<Plus />} className="mt-2">
          Add
        </Button>
      )}

      {/* Info */}
      <div className="mt-3 px-1">
        <h3 className="line-clamp-2 text-sm font-semibold text-black dark:text-white" title={item.title}>
          {item.title}
        </h3>
        {item.overview && <p className="line-clamp-3 text-xs text-gray-500 dark:text-gray-400" title={item.overview}>{item.overview}</p>}
        <p className="text-xs text-gray-500 dark:text-gray-400">{year}</p>
      </div>
    </div>
  );
}