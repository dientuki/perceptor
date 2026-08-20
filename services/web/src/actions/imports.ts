'use server'

import { redirectIfUnauthenticated } from '@/lib/auth-session';
import { fetchGraphQL } from '@/lib/graphql-client';
import { translateGraphQLError } from '@/lib/graphql-error';

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
    await redirectIfUnauthenticated(errors);
    throw new Error(await translateGraphQLError(errors[0]));
  }

  return data!.addMagnetToMovie;
}
