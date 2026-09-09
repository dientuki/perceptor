"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { MediaList } from "@/components/media/MediaList";
import { MEDIA_TYPE, type MediaType } from "@/types/media";
import type { MediaSearchResult } from "@/types/search";
import { MediaResultAction } from "./MediaResultAction";
import { SearchInput } from "./SearchInput";

interface SearchContainerProps {
  type: MediaType;
  addAction: (
    id: number,
    type: MediaType,
    asShort?: boolean,
  ) => Promise<string>;
  searchAction: (
    query: string,
    type: MediaType,
  ) => Promise<MediaSearchResult[]>;
  shortsEnabled?: boolean; // Opt-in: only the movies search grid has one to show
}

export default function SearchContainer({
  type,
  addAction,
  searchAction,
  shortsEnabled = false,
}: SearchContainerProps) {
  const t = useTranslations("search.container");
  const noun = type === MEDIA_TYPE.SHOW ? t("showNoun") : t("movieNoun");
  const [results, setResults] = useState<MediaSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [addingId, setAddingId] = useState<number | null>(null);
  const [addingShortId, setAddingShortId] = useState<number | null>(null);
  // TMDB id -> registered row id, for results added this session (before `inLibrary` would reflect it on a fresh search)
  const [addedMediaIds, setAddedMediaIds] = useState<Record<number, string>>(
    {},
  );

  const handleSearch = async (query: string) => {
    setLoading(true);
    setError(null);

    try {
      const data = await searchAction(query, type);
      setResults(data);
    } catch (err) {
      // Sin este catch el finally no corre y el botón queda deshabilitado para siempre
      console.error("Error al buscar:", err);
      setResults([]);
      setError(t("errorSearch"));
    } finally {
      setSearched(true);
      setLoading(false);
    }
  };

  const addItem = async (item: MediaSearchResult, asShort: boolean) => {
    try {
      const mediaId = await addAction(item.id, type, asShort);
      setAddedMediaIds((prev) => ({ ...prev, [item.id]: mediaId }));
    } catch (err) {
      console.error("Error al agregar:", err);
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
      <SearchInput onSearch={handleSearch} loading={loading} type={type} />

      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-red-700 dark:bg-red-500/10 dark:text-red-400">
          {error}
        </p>
      )}

      <MediaList
        items={results}
        showLink={false}
        showShortBadge={shortsEnabled}
        emptyMessage={
          searched
            ? t("resultsEmptySearched")
            : t("resultsEmptyPrompt", { noun })
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
