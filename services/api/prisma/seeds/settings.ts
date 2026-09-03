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
    { key: 'tracker_api_key', value: process.env.INDEXER_API_KEY ?? '' },

    // 'none' por default: una instalación limpia no le habla a nadie. Host
    // vacío a propósito: 'localhost' parece un valor válido pero adentro del
    // container api apunta al propio api, no a la PC del usuario — sembrarlo
    // ahí sólo esconde el error hasta que alguien elige Jellyfin y falla en
    // silencio. Vacío obliga a completarlo con el valor real (ver el hint en
    // MediaServerFields.tsx).
    { key: 'media_server_client', value: 'none' },
    { key: 'media_server_host', value: '' },
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
    { key: 'compression_enabled', value: 'true' },

    { key: 'ui_locale', value: '' },
    { key: 'default_languages', value: '' },

    // Cadence + enablement for the scheduler (src/scheduler/). Every task ships
    // disabled: an upgrade must not silently start hitting TMDB/the indexer on a
    // schedule nobody chose. Crons are 5-field expressions validated by the
    // 'cron' SettingKind in settings.catalog.ts.
    { key: 'schedule_refresh_movies_enabled', value: 'false' },
    { key: 'schedule_refresh_movies_cron', value: '0 4 * * *' },
    { key: 'schedule_refresh_shows_enabled', value: 'false' },
    { key: 'schedule_refresh_shows_cron', value: '0 5 * * *' },
    { key: 'schedule_refresh_episodes_enabled', value: 'false' },
    { key: 'schedule_refresh_episodes_cron', value: '0 6 * * *' },
    { key: 'schedule_acquire_pending_enabled', value: 'false' },
    { key: 'schedule_acquire_pending_cron', value: '0 * * * *' },

    // State the system writes about the media-server index rebuild (034), not
    // configuration a person sets — deliberately absent from
    // settings.catalog.ts so updateSettings keeps rejecting them, same as
    // torrent_port.
    { key: 'media_server_index_state', value: 'never' },
    { key: 'media_server_index_synced_at', value: '' },
    { key: 'media_server_index_count', value: '0' },
  ];

  // Create-only: unlike an upsert, this never overwrites a real value already
  // configured (tracker_api_key, movie_db_api_key, etc.) on a later run of the
  // seed. The one exception is a row that already exists but is still empty —
  // the state every installation is in before a human (or, for
  // tracker_api_key, INDEXER_API_KEY) supplies a real value — which gets
  // backfilled instead of left blank forever.
  for (const setting of settings) {
    const existing = await prisma.setting.findUnique({ where: { key: setting.key } });
    if (!existing) {
      await prisma.setting.create({ data: setting });
    } else if (existing.value === '' && setting.value !== '') {
      await prisma.setting.update({ where: { key: setting.key }, data: { value: setting.value } });
    }
  }

  console.log('Settings seeded');
}
