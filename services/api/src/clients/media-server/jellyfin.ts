import { MediaServerClient, MediaServerConfig } from './types';
import { HTTP_METHOD } from '@/types/http';

export const createJellyfinClient = (config: MediaServerConfig): MediaServerClient => {
  const host = config.host || 'localhost';
  const port = config.port || '8096';
  const apiKey = config.apiKey;

  const baseUrl = `http://${host}:${port}/`;

  return {
    /**
     * Refresh the Jellyfin library
     * This function sends a POST request to the Jellyfin API to refresh the library
     * https://api.jellyfin.org/#tag/Library/operation/RefreshLibrary
     * @returns {Promise<void>} A promise that resolves when the request has been sent
     */
    async refreshLibrary() {
      const endpoint = new URL('Library/Refresh', baseUrl);

      const response = await fetch(endpoint, {
        method: HTTP_METHOD.POST,
        headers: {
          'X-MediaBrowser-Token': apiKey,
        },
      });

      if (!response.ok) {
        throw new Error(`Jellyfin respondió ${response.status} al refrescar la biblioteca: ${await response.text()}`);
      }
    },

    /**
     * Notify Jellyfin that a media has been created
     * https://api.jellyfin.org/#tag/Library/operation/PostUpdatedMedia
     * @param {string} media The path of the created media
     * @returns {Promise<void>} A promise that resolves when the request has been sent
     */
    async createdMedia(media: string) {
      const endpoint = new URL(`Library/Media/Updated`, baseUrl);

      const response = await fetch(endpoint, {
        method: HTTP_METHOD.POST,
        headers: {
          'Content-Type': 'application/json',
          'X-MediaBrowser-Token': apiKey,
        },
        body: JSON.stringify({
          Updates: [
            {
              Path: media,
              UpdateType: 'created', // lo abstractamos aquí
            },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error(`Jellyfin respondió ${response.status} al avisar de ${media}: ${await response.text()}`);
      }
    },
  };
};
