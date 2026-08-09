'use server'

import { fetchGraphQL } from '@/lib/graphql-client';
import { MediaServerOption } from '@/types/media-server';

const MEDIA_SERVER_CLIENTS_QUERY = `
  query MediaServerClients {
    mediaServerClients {
      id
      label
    }
  }
`;

export async function getMediaServerOptions(): Promise<MediaServerOption[]> {
  const { data, errors } = await fetchGraphQL<{ mediaServerClients: MediaServerOption[] }>(
    MEDIA_SERVER_CLIENTS_QUERY,
  );

  if (errors && errors.length > 0) {
    throw new Error(errors[0]?.message || 'Error al obtener los media servers soportados');
  }

  return data?.mediaServerClients ?? [];
}
