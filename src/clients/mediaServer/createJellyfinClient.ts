import { MediaServerClient } from "./types";
import { HTTP_METHOD } from "@/types/http";

export const createJellyfinClient = (config : Record<string, string>): MediaServerClient => {
  
  const host = config.media_server_host ?? "localhost";
  const port = config.media_server_port ?? "8096";

  const api_key = config.media_server_api_key;

  const baseUrl = `http://${host}:${port}/`;

  return {
  
  
    /**
     * Refresh the Jellyfin library
     * This function sends a POST request to the Jellyfin API to refresh the library
     * https://api.jellyfin.org/#tag/Library/operation/RefreshLibrary
     * @returns {Promise<void>} A promise that resolves when the request has been sent
     */
    async refreshLibrary() {
        const endpoint = new URL("Library/Refresh", baseUrl);

        await fetch(endpoint, {
          method: HTTP_METHOD.POST,
          headers: {
            "X-MediaBrowser-Token": api_key,
          },
        });
    },

    /**
     * Notify Jellyfin that a media has been created
     * https://api.jellyfin.org/#tag/Library/operation/PostUpdatedMedia
     * @param {string} media The path of the created media
     * @returns {Promise<void>} A promise that resolves when the request has been sent
     */
    async createdMedia(media: string) {
        const endpoint = new URL(`Library/Media/Updated`, baseUrl);

        await fetch(endpoint, {
          method: HTTP_METHOD.POST,
          headers: {
            "Content-Type": "application/json",
            "X-MediaBrowser-Token": api_key,
          },
          body: JSON.stringify({
            Updates: [
              {
                Path: media,
                UpdateType: "created", // lo abstractamos aquí
              },
            ],
          }),
        });
    },
  };
}