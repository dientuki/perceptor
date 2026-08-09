export type MediaServerClient = {
  refreshLibrary: () => Promise<void>;
  createdMedia: (media: string) => Promise<void>;
};

// Lo que necesita cualquier implementación. Sale de SettingsService.getMap(),
// pero el cliente no lo sabe: recibe un objeto plano y es testeable sin Nest.
// Jellyfin y Plex se configuran igual (host + puerto + token); el día que un
// media server necesite otra cosa, este tipo es lo único que cambia.
export type MediaServerConfig = {
  host: string;
  port: string;
  apiKey: string;
};

export type MediaServerFactory = (config: MediaServerConfig) => MediaServerClient;

// 'none' no es un cliente: es la ausencia de uno. Vive fuera del registro.
export const MEDIA_SERVER_NONE = 'none';
