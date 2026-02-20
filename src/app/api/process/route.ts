import { NextRequest, NextResponse } from "next/server";
import { getItems } from "@/core/tmdb/storage";
import { search } from "@/core/search/prowlar";
import { create, update } from "@/core/jobs/storage";
import { addTorrent } from "@/core/search/add";
import { logger } from "@/lib/logger";

export async function POST(req: NextRequest) {
  try {
    const { ids } = await req.json();

    logger.info(
      { ids },
      'IDs recibidos para procesar:'
    );

    const items = await getItems(ids);

    logger.info(
      { items },
      'Items recuperados:'
    );

    // Aquí podrías agregar lógica adicional para procesar los items, como buscar torrents relacionados
    for (const item of items) {
      
      const query = item.search;
      logger.info(
        { query },
        'Buscando torrents para:'
      );
      create(item.tmdbId);
      const searchResult = await search(query);
      logger.info(
        { query },
        'Resultados de búsqueda para:'
      );      
      update(item.tmdbId, "starte download", { infoHash: searchResult.infoHash });

      logger.info(
        { searchResult },
        'Torrent agregado:'
      );

      addTorrent(searchResult.downloadUrl);
    }

    return NextResponse.json({ success: true, received: ids, items });
  } catch (error) {
    console.error("Error en /api/process:", error);
    return NextResponse.json({ error: "Error procesando la solicitud" }, { status: 500 });
  }
}