import { createJellyfinClient } from './jellyfin';
import { createPlexClient } from './plex';
import {
  MediaServerClient,
  MediaServerConfig,
  MediaServerRegistryEntry,
  MediaServerIndexPort,
  MEDIA_SERVER_NONE,
} from './types';
import { ERROR_KEYS } from '@/i18n/error-keys';
import { i18nError } from '@/i18n/i18n-error';

export const MEDIA_SERVERS = {
  jellyfin: {
    label: 'Jellyfin',
    create: createJellyfinClient,
    layout: 'jellyfin',
    defaultPort: 8096,
    credentialLabel: 'API key',
  },
  plex: {
    label: 'Plex',
    create: createPlexClient,
    layout: 'plex',
    defaultPort: 32400,
    credentialLabel: 'Plex token',
    credentialHelpUrl:
      'https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/',
  },
} satisfies Record<string, MediaServerRegistryEntry>;

export type MediaServerOptionData = {
  id: string;
  label: string;
  defaultPort: number | null;
  credentialLabel: string | null;
  credentialHelpUrl: string | null;
};

export const MEDIA_SERVER_OPTIONS: MediaServerOptionData[] = [
  {
    id: MEDIA_SERVER_NONE,
    label: 'Ninguno',
    defaultPort: null,
    credentialLabel: null,
    credentialHelpUrl: null,
  },
  ...Object.entries(MEDIA_SERVERS).map(
    ([id, entry]: [string, MediaServerRegistryEntry]) => ({
      id,
      label: entry.label,
      defaultPort: entry.defaultPort,
      credentialLabel: entry.credentialLabel,
      credentialHelpUrl: entry.credentialHelpUrl ?? null,
    }),
  ),
];

export const MEDIA_SERVER_IDS: string[] = MEDIA_SERVER_OPTIONS.map(
  (option) => option.id,
);

export function createMediaServerClient(
  id: string,
  config: MediaServerConfig,
  index: MediaServerIndexPort,
): MediaServerClient | null {
  if (id === MEDIA_SERVER_NONE) return null;
  const entry = MEDIA_SERVERS[id as keyof typeof MEDIA_SERVERS];
  if (!entry)
    throw i18nError.badRequest(ERROR_KEYS.MEDIA_SERVER_UNKNOWN, { id });
  return entry.create(config, index);
}
