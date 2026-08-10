// src/lib/graphql-client.ts
import { cookies } from 'next/headers';
import { CONFIG } from '@/lib/config';

export async function fetchGraphQL<T = any>(
  query: string,
  variables?: Record<string, any>,
  options: RequestInit = {}
): Promise<{ data?: T; errors?: any[] }> {

  const cookieStore = await cookies();
  const token = cookieStore.get(CONFIG.authCookie)?.value;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(CONFIG.graphqlUrl, {
    ...options,
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });

  try {
    return await res.json();
  } catch {
    return { errors: [{ message: 'Respuesta inválida del servidor GraphQL.' }] };
  }
}
