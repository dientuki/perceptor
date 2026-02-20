"use client";

import { useState } from "react";
import SearchForm from "./SearchForm";
import ResultsForm from "./ResultsForm";

export default function SearchContainer() {
  const [results, setResults] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);

  const handleSearch = async (query: string) => {
    //setStatus("loading");
    setSelectedIds([]);

    const res = await fetch("/api/ia", {
      method: "POST",
      body: JSON.stringify({ query }),
    });
    const data = await res.json();
    setResults(data);

    //setStatus("success");
  };

  const toggleSelection = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id)
        ? prev.filter((i) => i !== id)
        : [...prev, id]
    );
  };

  const handleProcess = async (e: React.FormEvent) => {
    e.preventDefault();
    await fetch("/api/process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: selectedIds }),
    });
  };

  return (
    <>
      <SearchForm onSearch={handleSearch} />
      <ResultsForm
        results={results}
        selectedIds={selectedIds}
        toggleSelection={toggleSelection}
        onProcess={handleProcess}
      />
    </>
  );
}
