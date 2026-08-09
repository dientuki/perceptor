import { PrismaClient } from '@prisma/client';

export async function seedSettings(prisma: PrismaClient) {
  console.log('Seeding settings...');

  const settings = [
    // Relativos a las raíces declaradas en .env (HOST_DOWNLOADS_DIR/
    // HOST_DESTINATIONS_DIR, ver media-roots/): '.' es la raíz misma, así
    // que estos tres literales preservan el layout de biblioteca de siempre
    // (Movies/Shows como subcarpetas) sin depender de leer CONTAINER_*_DIR
    // acá. Ver settings.service.ts::updateMany, que valida y normaliza
    // cualquier valor nuevo contra esas mismas raíces.
    { key: 'path_movies', value: 'Movies' },
    { key: 'path_shows', value: 'Shows' },
    { key: 'path_downloads', value: '.' },

    { key: 'torrent_client', value: 'qbittorrent' },
    { key: 'torrent_host', value: 'torrent' },
    { key: 'torrent_port', value: '8080' },
    { key: 'torrent_api_key', value: '' },

    { key: 'tracker_client', value: 'prowlarr' },
    { key: 'tracker_host', value: 'indexer' },
    { key: 'tracker_port', value: '9696' },
    { key: 'tracker_api_key', value: '' },

    // 'none' por default: una instalación limpia no le habla a nadie. Elegir
    // 'jellyfin' desde Settings usa estos host/port como valor inicial.
    { key: 'media_server_client', value: 'none' },
    { key: 'media_server_host', value: 'localhost' },
    { key: 'media_server_port', value: '8096' },
    { key: 'media_server_api_key', value: '' },

    { key: 'ia_model', value: 'gemini-3-flash-preview' },
    { key: 'ia_key', value: '' },

    { key: 'movie_db_client', value: 'tmdb' },
    { key: 'movie_db_host', value: 'https://api.themoviedb.org' },
    { key: 'movie_db_api_key', value: '' },
    { key: 'movie_db_api_version', value: '3' },

    { key: 'movies_enabled', value: 'true' },
    { key: 'shows_enabled', value: 'false' },
  ];

  // "Crear sólo si no existe": a diferencia de un upsert, esto no pisa valores
  // reales ya configurados (tracker_api_key, movie_db_api_key, etc.) en corridas
  // subsiguientes del seed.
  for (const setting of settings) {
    const existing = await prisma.setting.findUnique({ where: { key: setting.key } });
    if (!existing) {
      await prisma.setting.create({ data: setting });
    }
  }

  console.log('Settings seeded');
}
