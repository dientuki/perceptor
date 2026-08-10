'use server'

import { fetchGraphQL } from '@/lib/graphql-client';
import { redirectIfUnauthenticated } from '@/lib/auth-session';

export interface UploadTicket {
  token: string;
  expiresAt: string;
}

const CREATE_UPLOAD_TICKET_MUTATION = `
  mutation CreateUploadTicket($movieId: Int!) {
    createUploadTicket(movieId: $movieId) {
      token
      expiresAt
    }
  }
`;

export async function createUploadTicketAction(movieId: number): Promise<UploadTicket> {
  const { data, errors } = await fetchGraphQL<{ createUploadTicket: UploadTicket }>(
    CREATE_UPLOAD_TICKET_MUTATION,
    { movieId },
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
