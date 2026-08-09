import { Injectable } from '@nestjs/common';
import { SettingsService } from '@/settings/settings.service';
import { MediaRootsService } from '@/media-roots/media-roots.service';
import { createMediaServerClient } from '@/clients/media-server/registry';

@Injectable()
export class MediaServerService {
  constructor(
    private readonly settings: SettingsService,
    private readonly mediaRoots: MediaRootsService,
  ) {}

  // Aviso de "hay un archivo nuevo" al media server configurado. NUNCA tira:
  // lo llama encodeCompleted, y una excepción acá haría que el worker reciba
  // un error de GraphQL y llame a encodeFailed — marcando como ERROR un encode
  // que salió bien y cuyo archivo ya está en la biblioteca. Un aviso perdido se
  // arregla con un scan manual desde Jellyfin; un job en ERROR, no.
  async notifyCreated(containerFilePath: string): Promise<void> {
    try {
      const config = await this.settings.getMap();
      const clientId = config.media_server_client;

      const client = createMediaServerClient(clientId, {
        host: config.media_server_host,
        port: config.media_server_port,
        apiKey: config.media_server_api_key,
      });

      if (!client) {
        // 'none' (o setting faltante): configuración válida, no hay nada que avisar.
        return;
      }

      const hostFilePath = this.mediaRoots.containerToHostPath('library', containerFilePath);
      if (!hostFilePath) {
        console.warn(
          `[media-server] no se pudo traducir "${containerFilePath}" a una ruta del host — se omite el aviso`,
        );
        return;
      }

      await client.createdMedia(hostFilePath);
      console.log(`[media-server] avisado: ${hostFilePath}`);
    } catch (err) {
      console.error(`[media-server] falló el aviso de ${containerFilePath}:`, err);
    }
  }
}
