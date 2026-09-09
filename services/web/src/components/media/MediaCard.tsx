// components/Media/MediaCard.tsx
"use client";

import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { MEDIA_TYPE } from "@/types/media";

interface MediaCardProps {
  item: any;
  renderAction?: (item: any) => React.ReactNode;
  showLink: boolean; // Nueva propiedad para controlar si se muestra el enlace
  mediaType?: (typeof MEDIA_TYPE)[keyof typeof MEDIA_TYPE];
  showTypeBadge?: boolean; // Opt-in: a mixed grid needs it, a single-type grid doesn't
  showMeta?: boolean; // Opt-in: hide title/overview/year when the card renders its own caption
  showShortBadge?: boolean; // Opt-in: only rendered while shorts are effectively enabled
}

export function MediaCard({
  item,
  renderAction,
  showLink,
  mediaType,
  showTypeBadge = false,
  showMeta = true,
  showShortBadge = false,
}: MediaCardProps) {
  const t = useTranslations("media.card");
  // Read from the item's own type, never the `mediaType` prop — on a mixed
  // grid that prop is one value for cards of two different kinds.
  const isShow = item.type === MEDIA_TYPE.SHOW;
  const isShort = showShortBadge && item.isShort === true;
  const year = item.releaseDate
    ? new Date(item.releaseDate).getFullYear()
    : "N/A";

  const poster = item.posterUrl ? (
    <Image
      src={item.posterUrl}
      alt={item.title}
      fill
      sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
      className="object-cover transition-transform duration-300 group-hover:scale-105"
    />
  ) : (
    <span className="flex h-full items-center justify-center text-xs text-gray-400">
      {t("noPoster")}
    </span>
  );

  return (
    <div className="group relative flex flex-col rounded-xl border border-gray-200 bg-white p-2 shadow-sm transition-all hover:shadow-md dark:border-gray-800 dark:bg-white/[0.03]">
      {/* Poster */}
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800">
        {showTypeBadge && (
          <span
            className={`absolute left-2 top-2 z-10 rounded-full px-2 py-0.5 text-xs font-semibold uppercase text-white ${
              isShow ? "bg-purple-500" : "bg-brand-500"
            }`}
          >
            {isShow ? t("typeShow") : t("typeMovie")}
          </span>
        )}
        {isShort && (
          <span className="absolute right-2 top-2 z-10 rounded-full bg-amber-500 px-2 py-0.5 text-xs font-semibold uppercase text-white">
            {t("typeShort")}
          </span>
        )}
        {showLink ? (
          <Link
            href={
              mediaType === MEDIA_TYPE.SHOW
                ? `/shows/${item.id}`
                : `/movies/${item.id}`
            }
            className="block h-full w-full"
          >
            {poster}
          </Link>
        ) : (
          poster
        )}
      </div>
      {/* Slot para el Botón (encima del poster o donde prefieras) */}
      {renderAction && renderAction(item)}

      {/* Info */}
      {showMeta && (
        <div className="mt-3 px-1">
          <h3
            className="line-clamp-2 font-semibold text-black dark:text-white"
            title={item.title}
          >
            {item.title}
          </h3>
          {item.overview && (
            <p
              className="line-clamp-3 text-xs text-gray-500 dark:text-gray-400"
              title={item.overview}
            >
              {item.overview}
            </p>
          )}
          <p className="text-xs text-gray-500 dark:text-gray-400">{year}</p>
        </div>
      )}
    </div>
  );
}
