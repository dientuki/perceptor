'use server'

import { fetchGraphQL } from '@/lib/graphql-client';
import { redirectIfUnauthenticated } from '@/lib/auth-session';
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
    await redirectIfUnauthenticated(errors);
    throw new Error(errors[0]?.message || 'Error al obtener las raíces de media');
  }

  return data?.mediaRoots ?? [];
}
