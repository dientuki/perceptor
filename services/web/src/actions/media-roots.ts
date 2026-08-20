'use server'

import { redirectToClearSession } from '@/lib/auth-session';
import { fetchGraphQL } from '@/lib/graphql-client';
import { translateGraphQLError } from '@/lib/graphql-error';
import { MediaRoot } from '@/types/media-roots';

const MEDIA_ROOTS_QUERY = `
  query MediaRoots {
    mediaRoots {
      id
      label
      hostPath
      available
    }
  }
`;

export async function getMediaRoots(): Promise<MediaRoot[]> {
  const { data, errors } = await fetchGraphQL<{ mediaRoots: MediaRoot[] }>(MEDIA_ROOTS_QUERY);

  if (errors && errors.length > 0) {
    // Called directly from SettingsPage's Server Component render — cookie
    // mutation is illegal there, so hand off to the Route Handler instead.
    redirectToClearSession(errors);
    throw new Error(await translateGraphQLError(errors[0]));
  }

  return data?.mediaRoots ?? [];
}
