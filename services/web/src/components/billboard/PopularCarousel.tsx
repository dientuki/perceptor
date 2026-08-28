"use client";

import { useState } from "react";
import { addMedia } from "@/actions/media";
import { MediaCard } from "@/components/media/MediaCard";
import { MediaCarousel } from "@/components/media/MediaCarousel";
import { MediaResultAction } from "@/components/search/MediaResultAction";
import type { MediaSearchResult } from "@/types/search";

interface PopularCarouselProps {
  items: MediaSearchResult[];
  heading: string;
  initialError?: string | null;
}

// Client half of one billboard strip: owns the per-card add state exactly as
// MultiSearchResults does for /search, but renders through MediaCarousel
// instead of MediaList, and cards hide their metadata block (poster + badge
// + action only, per 033-billboard-and-navigation REQ-6).
export function PopularCarousel({
  items,
  heading,
  initialError = null,
}: PopularCarouselProps) {
  const [addingId, setAddingId] = useState<number | null>(null);
  // TMDB id -> registered row id, for results added this session (before
  // `inLibrary` would reflect it on a fresh fetch)
  const [addedMediaIds, setAddedMediaIds] = useState<Record<number, string>>(
    {},
  );

  const handleAdd = async (item: MediaSearchResult) => {
    setAddingId(item.id);

    try {
      const mediaId = await addMedia(item.id, item.type);
      setAddedMediaIds((prev) => ({ ...prev, [item.id]: mediaId }));
    } catch (err) {
      console.error("Error al agregar:", err);
    } finally {
      setAddingId(null);
    }
  };

  if (initialError) {
    return (
      <section>
        <h2 className="mb-3 text-lg font-semibold text-black dark:text-white">
          {heading}
        </h2>
        <p className="rounded-lg bg-red-50 px-4 py-3 text-red-700 dark:bg-red-500/10 dark:text-red-400">
          {initialError}
        </p>
      </section>
    );
  }

  return (
    <MediaCarousel heading={heading}>
      {items.map((item) => {
        const addedMediaId = addedMediaIds[item.id];
        const owned = item.inLibrary || addedMediaId !== undefined;
        const ownedMediaId = addedMediaId ?? String(item.mediaId);

        return (
          <MediaCard
            key={item.id}
            item={item}
            showMeta={false}
            showTypeBadge
            showLink={false}
            renderAction={() => (
              <MediaResultAction
                item={item}
                owned={owned}
                ownedMediaId={ownedMediaId}
                adding={addingId === item.id}
                onAdd={handleAdd}
              />
            )}
          />
        );
      })}
    </MediaCarousel>
  );
}
