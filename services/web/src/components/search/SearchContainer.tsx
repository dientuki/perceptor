"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MediaSearchResult } from "@/types/search";
import { SearchInput } from "./SearchInput";
import { MediaList } from "@/components/media/MediaList";
import { MediaType } from "@/types/media";
import Button from "@/components/ui/button/Button";
import { Plus } from "lucide-react";

interface SearchContainerProps {
  type: MediaType;
  addAction: (id: number, type: MediaType) => Promise<number>;
  searchAction: (query: string) => Promise<MediaSearchResult[]>; // Cambiado a una función que devuelve una promesa de booleano
}

export default function SearchContainer({ type, addAction, searchAction }: SearchContainerProps) {
  const [results, setResults] = useState<MediaSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [addingId, setAddingId] = useState<number | null>(null);
  const router = useRouter();

  const handleSearch = async (query: string) => {
    setLoading(true);
    setError(null);

    try {
      const data = await searchAction(query);
      setResults(data);
    } catch (err) {
      // Sin este catch el finally no corre y el botón queda deshabilitado para siempre
      console.error('Error al buscar:', err);
      setResults([]);
      setError('No se pudo completar la búsqueda. Intentá de nuevo.');
    } finally {
      setSearched(true);
      setLoading(false);
    }
  };

  const handleAdd = async (item: MediaSearchResult) => {
    setAddingId(item.id);
    setError(null);

    try {
      const id = await addAction(item.id, type);
      router.push(`/movies/${id}`);
    } catch (err) {
      console.error('Error al agregar:', err);
      setError('No se pudo agregar la película. Intentá de nuevo.');
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
        emptyMessage={searched ? "No se encontraron resultados" : "Buscá una película para empezar"}
        renderAction={(item) => (
          <Button
            size="sm"
            onClick={() => handleAdd(item)}
            startIcon={<Plus />}
            className="mt-2"
            disabled={addingId === item.id}
          >
            {addingId === item.id ? "Agregando..." : "Add"}
          </Button>
        )}
        />
    </div>
  );
}