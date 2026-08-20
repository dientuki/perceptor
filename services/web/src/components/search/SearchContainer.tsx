"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { MediaList } from "@/components/media/MediaList";
import Button from "@/components/ui/button/Button";
import { MEDIA_TYPE, type MediaType } from "@/types/media";
import type { MediaSearchResult } from "@/types/search";
import { SearchInput } from "./SearchInput";

interface SearchContainerProps {
  type: MediaType;
  addAction: (id: number, type: MediaType) => Promise<string>;
  searchAction: (
    query: string,
    type: MediaType,
  ) => Promise<MediaSearchResult[]>;
}

export default function SearchContainer({
  type,
  addAction,
  searchAction,
}: SearchContainerProps) {
  const t = useTranslations("search.container");
  const noun = type === MEDIA_TYPE.SHOW ? t("showNoun") : t("movieNoun");
  const [results, setResults] = useState<MediaSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [addingId, setAddingId] = useState<number | null>(null);
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

  const handleAdd = async (item: MediaSearchResult) => {
    setAddingId(item.id);
    setError(null);

    try {
      const mediaId = await addAction(item.id, type);
      setAddedMediaIds((prev) => ({ ...prev, [item.id]: mediaId }));
    } catch (err) {
      console.error("Error al agregar:", err);
      setError(t("errorAdd", { noun }));
    } finally {
      setAddingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <SearchInput onSearch={handleSearch} loading={loading} type={type} />

      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">
          {error}
        </p>
      )}

      <MediaList
        items={results}
        showLink={false}
        emptyMessage={
          searched
            ? t("resultsEmptySearched")
            : t("resultsEmptyPrompt", { noun })
        }
        renderAction={(item: MediaSearchResult) => {
          const addedMediaId = addedMediaIds[item.id];
          const owned = item.inLibrary || addedMediaId !== undefined;

          if (owned) {
            if (type === MEDIA_TYPE.SHOW) {
              return (
                <span className="mt-2 inline-flex items-center justify-center gap-2 rounded-lg bg-gray-100 px-4 py-3 text-sm font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                  {t("added")}
                </span>
              );
            }

            const mediaId = addedMediaId ?? String(item.mediaId);
            return (
              <Link
                href={`/movies/${mediaId}`}
                className="mt-2 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-3 text-sm font-medium text-white shadow-theme-xs transition hover:bg-brand-600"
              >
                {t("go")}
              </Link>
            );
          }

          return (
            <Button
              size="sm"
              onClick={() => handleAdd(item)}
              startIcon={<Plus />}
              className="mt-2"
              disabled={addingId === item.id}
            >
              {addingId === item.id ? t("adding") : t("addButton")}
            </Button>
          );
        }}
      />
    </div>
  );
}
