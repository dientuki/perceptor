'use server'

import { fetchGraphQL } from '@/lib/graphql-client';

const ADD_MAGNET_MUTATION = `
  mutation AddMagnetToMovie($movieId: Int!, $magnet: String!, $force: Boolean) {
    addMagnetToMovie(movieId: $movieId, magnet: $magnet, force: $force) {
      id
      status
    }
  }
`;

export async function importMagnetAction(
  movieId: number,
  magnet: string,
  force = false,
): Promise<{ id: number; status: string }> {
  const { data, errors } = await fetchGraphQL<{ addMagnetToMovie: { id: number; status: string } }>(
    ADD_MAGNET_MUTATION,
    { movieId, magnet, force },
  );

  if (errors && errors.length > 0) {
    throw new Error(errors[0]?.message || 'Error al importar el magnet');
  }

  return data!.addMagnetToMovie;
}
