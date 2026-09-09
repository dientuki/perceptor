"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { addMedia } from "@/actions/media";
import { MediaList } from "@/components/media/MediaList";
import { MEDIA_TYPE } from "@/types/media";
import type { MediaSearchResult } from "@/types/search";
import { MediaResultAction } from "./MediaResultAction";

interface MultiSearchResultsProps {
  results: MediaSearchResult[];
  searched: boolean;
  initialError?: string | null;
  shortsEnabled?: boolean;
}

// Client-side twin of SearchContainer for the mixed /search screen: the
// results are already fetched server-side, so this component only owns the
// per-card add state and never calls searchAllMedia itself.
export function MultiSearchResults({
  results,
  searched,
  initialError = null,
  shortsEnabled = false,
}: MultiSearchResultsProps) {
  const t = useTranslations("search.container");
  const [error, setError] = useState<string | null>(initialError);
  const [addingId, setAddingId] = useState<number | null>(null);
  const [addingShortId, setAddingShortId] = useState<number | null>(null);
  // TMDB id -> registered row id, for results added this session (before
  // `inLibrary` would reflect it on a fresh search)
  const [addedMediaIds, setAddedMediaIds] = useState<Record<number, string>>(
    {},
  );

  const addItem = async (item: MediaSearchResult, asShort: boolean) => {
    try {
      const mediaId = await addMedia(item.id, item.type, asShort);
      setAddedMediaIds((prev) => ({ ...prev, [item.id]: mediaId }));
    } catch (err) {
      console.error("Error al agregar:", err);
      const noun =
        item.type === MEDIA_TYPE.SHOW ? t("showNoun") : t("movieNoun");
      setError(
        err instanceof Error && asShort ? err.message : t("errorAdd", { noun }),
      );
    }
  };

  const handleAdd = async (item: MediaSearchResult) => {
    setAddingId(item.id);
    setError(null);
    await addItem(item, false);
    setAddingId(null);
  };

  const handleAddAsShort = async (item: MediaSearchResult) => {
    setAddingShortId(item.id);
    setError(null);
    await addItem(item, true);
    setAddingShortId(null);
  };

  return (
    <div className="space-y-6">
      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-red-700 dark:bg-red-500/10 dark:text-red-400">
          {error}
        </p>
      )}

      <MediaList
        items={results}
        showLink={false}
        showTypeBadge
        showShortBadge={shortsEnabled}
        emptyMessage={
          searched
            ? t("resultsEmptySearched")
            : t("resultsEmptyPrompt", {
                noun: `${t("movieNoun")} / ${t("showNoun")}`,
              })
        }
        renderAction={(item: MediaSearchResult) => {
          const addedMediaId = addedMediaIds[item.id];
          const owned = item.inLibrary || addedMediaId !== undefined;
          const ownedMediaId = addedMediaId ?? String(item.mediaId);

          return (
            <MediaResultAction
              item={item}
              owned={owned}
              ownedMediaId={ownedMediaId}
              adding={addingId === item.id}
              onAdd={handleAdd}
              shortsEnabled={shortsEnabled}
              addingShort={addingShortId === item.id}
              onAddAsShort={handleAddAsShort}
            />
          );
        }}
      />
    </div>
  );
}
