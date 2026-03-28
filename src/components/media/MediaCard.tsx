// components/Media/MediaCard.tsx
import { MediaSearchResult } from "@/search/types";
import { MEDIA_TYPE } from "@/types/media";
import Image from "next/image";
import Link from "next/link";

interface MediaCardProps {
  item: MediaSearchResult;
  renderAction?: (item: MediaSearchResult) => React.ReactNode;
}

export function MediaCard({ item, renderAction }: MediaCardProps) {
  const year = item.releaseDate ? new Date(item.releaseDate).getFullYear() : "N/A";

  const poster = item.posterUrl ? (
    <Image
      src={item.posterUrl}
      alt={item.title}
      fill
      sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
      className="object-cover transition-transform duration-300 group-hover:scale-105"
    />
  ) : (
    <span className="flex h-full items-center justify-center text-xs text-gray-400">Sin Poster</span>
  );

  return (
    <div className="group relative flex flex-col rounded-xl border border-gray-200 bg-white p-2 shadow-sm transition-all hover:shadow-md dark:border-gray-800 dark:bg-white/[0.03]">
      {/* Poster */}
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800">
        {item.showLink ? (
          <Link href={item.type === MEDIA_TYPE.TV ? `/shows/${item.id}` : `/movies/${item.id}`} className="block h-full w-full">
            {poster}
          </Link>
        ) : (
          poster
        )}
      </div>
      {/* Slot para el Botón (encima del poster o donde prefieras) */}
      {renderAction && (
        renderAction(item)
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