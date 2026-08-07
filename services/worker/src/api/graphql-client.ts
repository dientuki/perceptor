// Misma forma que services/web/src/lib/graphql-client.ts (fetch, POST, JSON),
// con dos diferencias: lee INTERNAL_GRAPHQL_URL, y tira si viene json.errors.
// Web renderiza los errores; un worker que se los tragara marcaría el job como
// completed sin haber escrito nada. Es el único manejo de errores que hace
// falta acá.

export async function fetchGraphQL<T = unknown>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const url = process.env.INTERNAL_GRAPHQL_URL;
  if (!url) throw new Error('INTERNAL_GRAPHQL_URL no está definida');

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });

  const json = (await res.json()) as { data?: T; errors?: unknown[] };

  if (json.errors && json.errors.length > 0) {
    throw new Error(`Error de GraphQL: ${JSON.stringify(json.errors)}`);
  }

  return json.data as T;
}
