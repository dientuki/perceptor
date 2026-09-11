import { fetchGraphQL } from './graphql-client';

interface EncodeWorkerStartedResponse {
  encodeWorkerStarted: number;
}

const MUTATION = `
  mutation {
    encodeWorkerStarted
  }
`;

export async function reportEncodeWorkerStarted(): Promise<number> {
  const data = await fetchGraphQL<EncodeWorkerStartedResponse>(MUTATION);
  return data.encodeWorkerStarted;
}
