import { prisma } from "@/lib/prisma";

export async function saveTmdbResults(mediaList: any[], tmdbSearch: { endpoint: string }) {
  for (const item of mediaList) {
    // 1. Determinar media_type
    // Si existe en el item, lo usamos. Si no, lo inferimos del endpoint de búsqueda.
    let mediaType = item.media_type;
    
    if (!mediaType) {
      if (tmdbSearch.endpoint.includes("movie")) {
        mediaType = "movie";
      } else if (tmdbSearch.endpoint.includes("tv")) {
        mediaType = "tv";
      } else {
        mediaType = "unknown";
      }
    }

    // 3. Guardar en Prisma
    // Usamos upsert: si existe (por tmdbId + media_type), actualiza; si no, crea.
    await prisma.tmdbResult.upsert({
      where: {
        tmdbId_media_type: {
          tmdbId: item.id,
          media_type: mediaType,
        },
      },
      update: {
        overview: item.overview,
        poster_path: item.poster_path,
        backdrop_path: item.backdrop_path,
        title: item.title,
        original_title: item.original_title,
        release_date: item.release_date,
        name: item.name,
        original_name: item.original_name,
        first_air_date: item.first_air_date,
        adult: item.adult,
        original_language: item.original_language,
        popularity: item.popularity,
        vote_average: item.vote_average,
        vote_count: item.vote_count,
        video: item.video,
      },
      create: {
        tmdbId: item.id,
        media_type: mediaType,
        overview: item.overview,
        poster_path: item.poster_path,
        backdrop_path: item.backdrop_path,
        title: item.title,
        original_title: item.original_title,
        release_date: item.release_date,
        name: item.name,
        original_name: item.original_name,
        first_air_date: item.first_air_date,
        adult: item.adult,
        original_language: item.original_language,
        popularity: item.popularity,
        vote_average: item.vote_average,
        vote_count: item.vote_count,
        video: item.video,
      },
    });
  }
}

export async function getItems(ids: number[]) {
  const items = await prisma.tmdbResult.findMany({
    where: {
      tmdbId: { in: ids },
    },
    select: {
      tmdbId: true,
      release_date: true,
      first_air_date: true,
      title: true,
      name: true,
      media_type: true,
    },
  });

  return items.map((item) => {
    const date = item.release_date || item.first_air_date;
    const year = date ? parseInt(date.substring(0, 4), 10) : null;
    const name = (item.title || item.name)?.replace(/[:\-]/g, ' ')   // los reemplaza por espacio
                .replace(/\s+/g, ' ')     // colapsa espacios múltiples
                .trim();                  // quita espacios al inicio/final
    const search = `${name} (${year})`;
    return { tmdbId: item.tmdbId, year, name, media_type: item.media_type, search };
  });
}