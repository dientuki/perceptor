"use client";

import { useState } from "react";
import { MediaSearchResult } from "@/search/types";
import { SearchInput } from "./SearchInput";
import { searchAction } from "@/actions/search";
import { MediaList } from "@/components/media/MediaList";
import { MediaType } from "@/types/media";
import Button from "@/components/ui/button/Button";
import { Plus } from "lucide-react";
import { logger } from "@/lib/logger";

interface SearchContainerProps {
  type: MediaType;
  addAction: (item: MediaSearchResult) => Promise<void>;
}

export default function SearchContainer({ type, addAction }: SearchContainerProps) {
  const [results, setResults] = useState<MediaSearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  const handleSearch = async (query: string) => {
    setLoading(true);
    const data = await searchAction(query, type);
    setResults(data);
    setLoading(false);
    
    logger.info({ count: data.length, type }, "Búsqueda de medios realizada");
  };

  const handleAdd = async (item: MediaSearchResult) => {
    await addAction(item);
  };

  return (
    <div className="space-y-6">
      <SearchInput onSearch={handleSearch} loading={loading} type={type} />

      <MediaList
        items={results} 
        renderAction={(item) => (
          <Button size="sm" onClick={() => handleAdd(item)} startIcon={<Plus />} className="mt-2">
            Add
          </Button>
        )}
        />
    </div>
  );
}