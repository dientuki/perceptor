'use server'

import { redirectToClearSession } from '@/lib/auth-session';
import { fetchGraphQL } from '@/lib/graphql-client';
import { translateGraphQLError } from '@/lib/graphql-error';
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
    // Called directly from SettingsPage's Server Component render — cookie
    // mutation is illegal there, so hand off to the Route Handler instead.
    redirectToClearSession(errors);
    throw new Error(await translateGraphQLError(errors[0]));
  }

  return data?.mediaServerClients ?? [];
}
