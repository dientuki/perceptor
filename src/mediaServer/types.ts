export const MEDIA_SERVER_CLIENTS = {
  JELLYFIN: "jellyfin"
} as const;

export type MediaServerClientType =
  (typeof MEDIA_SERVER_CLIENTS)[keyof typeof MEDIA_SERVER_CLIENTS];

export type MediaServerClient = {
  refreshLibrary: () => Promise<void>;
  createdMedia: (media: string) => Promise<void>;
};