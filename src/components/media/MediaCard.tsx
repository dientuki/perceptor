// components/Media/MediaCard.tsx
import { MediaSearchResult } from "@/search/types";

interface MediaCardProps {
  item: MediaSearchResult;
  renderAction?: (item: MediaSearchResult) => React.ReactNode;
}

export function MediaCard({ item, renderAction }: MediaCardProps) {
  const year = item.releaseDate ? new Date(item.releaseDate).getFullYear() : "N/A";

  return (
    <div className="group relative flex flex-col rounded-xl border border-gray-200 bg-white p-2 shadow-sm transition-all hover:shadow-md dark:border-gray-800 dark:bg-white/[0.03]">
      {/* Poster */}
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800">
        {item.posterUrl ? (
          <img
            src={item.posterUrl}
            alt={item.title}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-gray-400">Sin Poster</div>
        )}
        
        {/* Slot para el Botón (encima del poster o donde prefieras) */}
        {renderAction && (
          <div className="absolute right-2 top-2 z-10 opacity-0 transition-opacity group-hover:opacity-100">
            {renderAction(item)}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="mt-3 px-1">
        <h3 className="line-clamp-2 text-sm font-semibold text-black dark:text-white" title={item.title}>
          {item.title}
        </h3>
        {item.description && <p className="line-clamp-3 text-xs text-gray-500 dark:text-gray-400" title={item.description}>{item.description}</p>}
        <p className="text-xs text-gray-500 dark:text-gray-400">{year}</p>
      </div>
    </div>
  );
}