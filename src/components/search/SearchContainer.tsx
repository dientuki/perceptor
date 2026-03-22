"use client";

import { useState } from "react";
import { MediaSearchResult } from "@/search/types";
import { SearchInput } from "./SearchInput";
import { searchAction } from "@/actions/search";
import { MediaList } from "@/components/media/MediaList";
import { MediaType } from "@/types/media";


interface SearchContainerProps {
  type: MediaType;
  addAction: (item: MediaSearchResult) => Promise<any>;
}

export default function SearchContainer({ type, addAction }: SearchContainerProps) {
  const [results, setResults] = useState<MediaSearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  const handleSearch = async (query: string) => {
    setLoading(true);
    const data = await searchAction(query, type);
    setResults(data);
    setLoading(false);

    console.log(data);
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
            <button 
            onClick={() => handleAdd(item)}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-white shadow-lg hover:bg-primary/90"
            >
            +
            </button>
        )}
        />
    </div>
  );
}