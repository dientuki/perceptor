import { Injectable } from '@nestjs/common';
import { SettingsService } from '@/settings/settings.service';
import { MediaRootsService } from '@/media-roots/media-roots.service';
import { MediaServerIndexService } from '@/media-server-index/media-server-index.service';
import {
  createMediaServerClient,
  MEDIA_SERVERS,
} from '@/clients/media-server/registry';
import {
  DEFAULT_LIBRARY_LAYOUT,
  LibraryLayout,
  MEDIA_SERVER_NONE,
  MediaServerRegistryEntry,
} from '@/clients/media-server/types';

@Injectable()
export class MediaServerService {
  constructor(
    private readonly settings: SettingsService,
    private readonly mediaRoots: MediaRootsService,
    private readonly index: MediaServerIndexService,
  ) {}

  resolveLibraryLayout(settingsMap: Record<string, string>): LibraryLayout {
    const clientId = settingsMap.media_server_client;
    if (!clientId || !Object.hasOwn(MEDIA_SERVERS, clientId)) {
      return DEFAULT_LIBRARY_LAYOUT;
    }
    const entry: MediaServerRegistryEntry =
      MEDIA_SERVERS[clientId as keyof typeof MEDIA_SERVERS];
    return entry.layout;
  }

  async notifyCreated(containerFilePath: string): Promise<void> {
    try {
      const config = await this.settings.getMap();
      const clientId = config.media_server_client;

      if (
        clientId &&
        clientId !== MEDIA_SERVER_NONE &&
        !config.media_server_host
      ) {
        console.warn(
          `[media-server] "${clientId}" configured with no host — set media_server_host in Settings`,
        );
        return;
      }

      const client = createMediaServerClient(
        clientId,
        {
          host: config.media_server_host,
          port: config.media_server_port,
          apiKey: config.media_server_api_key,
        },
        // notifyCreated itself never resolves a TMDB id, but the client it
        // builds may (e.g. Jellyfin's findByTmdbId, reused elsewhere) — the
        // shared index is the one real implementation of this port.
        { lookup: (mediaType, tmdbId) => this.index.lookup(mediaType, tmdbId) },
      );

      if (!client) {
        return;
      }

      const hostFilePath = this.mediaRoots.containerToHostPath(
        'library',
        containerFilePath,
      );
      if (!hostFilePath) {
        console.warn(
          `[media-server] no se pudo traducir "${containerFilePath}" a una ruta del host — se omite el aviso`,
        );
        return;
      }

      await client.createdMedia(hostFilePath);
      console.log(`[media-server] notified: ${hostFilePath}`);
    } catch (err) {
      console.error(
        `[media-server] notify failed for ${containerFilePath}:`,
        err,
      );
    }
  }
}
