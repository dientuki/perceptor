'use server'

import { fetchGraphQL } from '@/lib/graphql-client';
import { redirectIfUnauthenticated } from '@/lib/auth-session';
import type { AcquisitionTarget } from '@/types/media';

export interface UploadTicket {
  token: string;
  expiresAt: string;
}

// CHANGED: both arguments are now nullable on the API side — exactly one must
// be supplied. Sent by name below, never positionally, since a bare
// positional id is how a film upload could silently mint a ticket for
// `undefined` once `movieId` stopped being required.
const CREATE_UPLOAD_TICKET_MUTATION = `
  mutation CreateUploadTicket($movieId: Int, $episodeId: Int) {
    createUploadTicket(movieId: $movieId, episodeId: $episodeId) {
      token
      expiresAt
    }
  }
`;

export async function createUploadTicketAction(target: AcquisitionTarget): Promise<UploadTicket> {
  const variables =
    target.kind === 'movie'
      ? { movieId: Number(target.movie.id), episodeId: undefined }
      : { movieId: undefined, episodeId: Number(target.episode.id) };

  const { data, errors } = await fetchGraphQL<{ createUploadTicket: UploadTicket }>(
    CREATE_UPLOAD_TICKET_MUTATION,
    variables,
  );

  if (errors && errors.length > 0) {
    await redirectIfUnauthenticated(errors);
    throw new Error(errors[0]?.message || 'Error al generar el permiso de subida');
  }

  if (!data?.createUploadTicket) {
    throw new Error('El API no devolvió el permiso de subida');
  }

  return data.createUploadTicket;
}
