// src/lib/graphql-client.ts
import { CONFIG } from '@/lib/config';

export async function fetchGraphQL<T = any>(
  query: string, 
  variables?: Record<string, any>, 
  options: RequestInit = {}
): Promise<{ data?: T; errors?: any[] }> {

  console.log('CONFIG.graphqlUrl', CONFIG.graphqlUrl);

  console.log('request', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    body: JSON.stringify({ query, variables }),
    ...options,
  })

  const res = await fetch(CONFIG.graphqlUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    body: JSON.stringify({ query, variables }),
    ...options,
  });

  return res.json();
}