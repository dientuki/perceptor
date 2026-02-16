"use client";

import { Button, Field, Input, Label } from "@headlessui/react";
import { useState } from "react";

export default function CreateJobPage() {
  const [query, setQuery] = useState("bajame la ultima de mision imposible");
  const [status, setStatus] = useState<"idle" | "loading" | "success">("idle");
  const [results, setResults] = useState<any[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setSelectedIds([]);

    const res = await fetch("/api/ia", {
      method: "POST",
      body: JSON.stringify({ query }),
    });
    const data = await res.json();
    setResults(data);

    setStatus("success");
  }

  async function handleProcess(e: React.FormEvent) {
    e.preventDefault();
    await fetch("/api/process", {
      method: "POST",
      body: JSON.stringify({ ids: selectedIds }),
    });
    alert("Enviando IDs: " + selectedIds.join(", "));
  }

  function toggleSelection(id: number) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-neutral-900 text-white">
      <div className="w-full max-w-md p-6 bg-neutral-800 rounded-xl shadow-lg space-y-6">
        <h1 className="text-2xl font-bold">Buscar peli</h1>
        
        <form onSubmit={handleSubmit} className="space-y-4">
                  
          <Field className="space-y-1">
            <Label className="text-sm text-neutral-300">
              Query
            </Label>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full p-2 rounded bg-neutral-700 border border-neutral-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div>Liseys.Story.S01sE07.mkv</div>
            <div>Liseys.Story.S01E08.mkv</div>
          </Field>

          <Button
            type="submit"
            className="w-full bg-blue-600 hover:bg-blue-500 transition p-2 rounded font-semibold"
          >
            Crear
          </Button>

        </form>

        {results.length > 0 && (
          <form onSubmit={handleProcess} className="space-y-4 border-t border-neutral-700 pt-4">
            <div className="space-y-2">
              {results.map((item) => (
                <label key={item.id} className="flex items-center gap-3 p-3 bg-neutral-700 rounded-lg cursor-pointer hover:bg-neutral-600 transition">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(item.id)}
                    onChange={() => toggleSelection(item.id)}
                    className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span>{item.title || item.name}</span>
                </label>
              ))}
            </div>
            <Button type="submit" className="w-full bg-green-600 hover:bg-green-500 transition p-2 rounded font-semibold">
              Procesar Selección
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}