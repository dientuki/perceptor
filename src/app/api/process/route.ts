import { NextRequest, NextResponse } from "next/server";
import { getItems } from "@/core/tmdb/storage";
import { search } from "@/core/search/prowlar";

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
      const searchResults = await search(query);
      console.log(`Resultados de búsqueda para "${query}":`, searchResults);
    }

    return NextResponse.json({ success: true, received: ids, items });
  } catch (error) {
    console.error("Error en /api/process:", error);
    return NextResponse.json({ error: "Error procesando la solicitud" }, { status: 500 });
  }
}