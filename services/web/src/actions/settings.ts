'use server'

import { fetchGraphQL } from '@/lib/graphql-client';
import { Setting } from '@/types/settings';

const SETTINGS_QUERY = `
  query Settings {
    settings {
      key
      value
    }
  }
`;

export async function getSettings(): Promise<Setting[]> {
  const { data, errors } = await fetchGraphQL<{ settings: Setting[] }>(SETTINGS_QUERY);

  if (errors && errors.length > 0) {
    throw new Error(errors[0]?.message || 'Error al obtener la configuración');
  }

  return data?.settings ?? [];
}

const UPDATE_SETTINGS_MUTATION = `
  mutation UpdateSettings($entries: [SettingInput!]!) {
    updateSettings(entries: $entries) {
      key
      value
    }
  }
`;

// Las claves que este form conoce y puede guardar. El resto de los settings
// (torrent_client, torrent_host, torrent_port, ia_*, movie_db_client,
// movie_db_host) no se editan acá — torrent_port en particular no tiene sentido editarlo:
// es el puerto interno de qBittorrent dentro de la red de Docker (QBITTORRENT_WEBUI_PORT
// en .env), no algo que el usuario final deba tocar.
const EDITABLE_KEYS = [
  'path_downloads',
  'tracker_api_key',
  'movie_db_api_key',
  'path_movies',
  'path_shows',
  'media_server_client',
  'media_server_host',
  'media_server_port',
  'media_server_api_key',
] as const;

// Checkboxes nativos: si no están tildados, ni siquiera viajan en el FormData.
// Por eso van aparte del filtro de EDITABLE_KEYS (que descarta ausentes/vacíos)
// y se agregan siempre como entry explícita 'true'/'false'.
const BOOLEAN_KEYS = ['movies_enabled', 'shows_enabled'] as const;

export async function updateSettingsAction(
  prevState: any,
  formData: FormData,
): Promise<{ error?: string } | { success: true }> {
  const entries: { key: string; value: string }[] = EDITABLE_KEYS
    .map((key) => ({ key, value: formData.get(key) }))
    .filter(
      (entry): entry is { key: (typeof EDITABLE_KEYS)[number]; value: string } =>
        typeof entry.value === 'string' && entry.value.trim() !== '',
    );

  for (const key of BOOLEAN_KEYS) {
    entries.push({ key, value: formData.has(key) ? 'true' : 'false' });
  }

  if (entries.length === 0) {
    return { error: 'No hay valores para guardar.' };
  }

  try {
    const { errors } = await fetchGraphQL(UPDATE_SETTINGS_MUTATION, { entries });

    if (errors && errors.length > 0) {
      return { error: errors[0].message || 'Error al guardar la configuración' };
    }

    return { success: true };
  } catch (err) {
    return { error: 'Error de conexión con el servidor GraphQL.' };
  }
}
