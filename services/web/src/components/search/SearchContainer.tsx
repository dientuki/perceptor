"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { MediaList } from "@/components/media/MediaList";
import Button from "@/components/ui/button/Button";
import type { MediaType } from "@/types/media";
import type { MediaSearchResult } from "@/types/search";
import { SearchInput } from "./SearchInput";

interface SearchContainerProps {
  type: MediaType;
  addAction: (id: number, type: MediaType) => Promise<string>;
  searchAction: (query: string) => Promise<MediaSearchResult[]>; // Cambiado a una función que devuelve una promesa de booleano
}

export default function SearchContainer({
  type,
  addAction,
  searchAction,
}: SearchContainerProps) {
  const [results, setResults] = useState<MediaSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [addingId, setAddingId] = useState<number | null>(null);
  // TMDB id -> Movie id, for results added this session (before `inLibrary` would reflect it on a fresh search)
  const [addedMovieIds, setAddedMovieIds] = useState<Record<number, string>>(
    {},
  );

  const handleSearch = async (query: string) => {
    setLoading(true);
    setError(null);

    try {
      const data = await searchAction(query);
      setResults(data);
    } catch (err) {
      // Sin este catch el finally no corre y el botón queda deshabilitado para siempre
      console.error("Error al buscar:", err);
      setResults([]);
      setError("No se pudo completar la búsqueda. Intentá de nuevo.");
    } finally {
      setSearched(true);
      setLoading(false);
    }
  };

  const handleAdd = async (item: MediaSearchResult) => {
    setAddingId(item.id);
    setError(null);

    try {
      const movieId = await addAction(item.id, type);
      setAddedMovieIds((prev) => ({ ...prev, [item.id]: movieId }));
    } catch (err) {
      console.error("Error al agregar:", err);
      setError("No se pudo agregar la película. Intentá de nuevo.");
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
            ? "No se encontraron resultados"
            : "Buscá una película para empezar"
        }
        renderAction={(item: MediaSearchResult) => {
          const addedMovieId = addedMovieIds[item.id];
          const owned = item.inLibrary || addedMovieId !== undefined;

          if (owned) {
            const movieId = addedMovieId ?? String(item.movieId);
            return (
              <Link
                href={`/movies/${movieId}`}
                className="mt-2 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-3 text-sm font-medium text-white shadow-theme-xs transition hover:bg-brand-600"
              >
                Ir
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
              {addingId === item.id ? "Agregando..." : "Agregar"}
            </Button>
          );
        }}
      />
    </div>
  );
}
