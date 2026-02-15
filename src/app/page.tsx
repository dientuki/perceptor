"use client";

import { useState } from "react";
import { Field, Input, Label, Button } from "@headlessui/react";

export default function Home() {
  const [filename, setFilename] = useState("/home/dientuki/Videos/Mission.Impossible.The.Final.Reckoning.2025.1080p.BluRay.REMUX.MULTi.TrueHD.Atmos.H264-BEN.THE.MEN/mi7-original.mkv");
  const [language, setLanguage] = useState("eng");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const res = await fetch("/api/convert", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filename,
        language,
      }),
    });

    const data = await res.json();
    console.log("Response:", data);
  }


  return (
    <main className="min-h-screen flex items-center justify-center bg-neutral-900 text-white">
      <div className="w-full max-w-md p-6 bg-neutral-800 rounded-xl shadow-lg space-y-6">
        <h1 className="text-2xl font-bold">Nuevo Torrent</h1>

        <form onSubmit={handleSubmit} className="space-y-4">
          
          <Field className="space-y-1">
            <Label className="text-sm text-neutral-300">
              Archivo torrent
            </Label>
            <Input
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              className="w-full p-2 rounded bg-neutral-700 border border-neutral-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </Field>

          <Field className="space-y-1">
            <Label className="text-sm text-neutral-300">
              Idioma original
            </Label>
            <Input
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full p-2 rounded bg-neutral-700 border border-neutral-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
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
