"use client";

import { Button, Field, Input, Label } from "@headlessui/react";
import { useState } from "react";

export default function CreateJobPage() {
  const [query, setQuery] = useState("bajame la ultima de mision imposible");
  const [status, setStatus] = useState<"idle" | "loading" | "success">("idle");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");

    await fetch("/api/ia", {
      method: "POST",
      body: JSON.stringify({ query }),
    });

    setStatus("success");
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
      </div>
    </main>
  );
}