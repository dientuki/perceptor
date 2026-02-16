import { NextRequest, NextResponse } from "next/server";
import { getItems } from "@/core/tmdb/storage";
import { search } from "@/core/search/prowlar";
import { create, update } from "@/core/jobs/storage";
import { addTorrent } from "@/core/search/add";

export async function POST(req: NextRequest) {
  try {
    const { ids } = await req.json();

    console.log("IDs recibidos para procesar:", ids);

    const items = await getItems(ids);

    console.log("Items recuperados:", items);

    // Aquí podrías agregar lógica adicional para procesar los items, como buscar torrents relacionados
    for (const item of items) {
      
      const query = item.search;
      console.log(`Buscando torrents para: ${query}`);
      create(item.tmdbId);
      const searchResult = await search(query);
      console.log(`Resultados de búsqueda para "${query}":`, searchResult);
      update(item.tmdbId, "starte download");

      console.log(`Torrent agregado: ${searchResult}`);

      addTorrent(searchResult);
    }

    return NextResponse.json({ success: true, received: ids, items });
  } catch (error) {
    console.error("Error en /api/process:", error);
    return NextResponse.json({ error: "Error procesando la solicitud" }, { status: 500 });
  }
}