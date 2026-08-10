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

  const token = process.env.SERVICE_TOKEN;
  if (!token) throw new Error('SERVICE_TOKEN no está definida');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  // Independent second net alongside the json.errors check below: Apollo
  // answers auth failures with HTTP 200 and a GraphQL error, but a non-2xx
  // status (e.g. a proxy or a hard 401 outside Apollo) must fail just as
  // loudly, not be swallowed because json.errors happened to be empty.
  if (!res.ok) {
    let body: string;
    try {
      body = await res.text();
    } catch {
      body = '<unreadable body>';
    }
    throw new Error(`GraphQL request failed with HTTP ${res.status}: ${body}`);
  }

  let json: { data?: T; errors?: unknown[] };
  try {
    json = (await res.json()) as { data?: T; errors?: unknown[] };
  } catch {
    throw new Error(
      `GraphQL response was not valid JSON (HTTP ${res.status})`,
    );
  }

  if (json.errors && json.errors.length > 0) {
    throw new Error(`Error de GraphQL: ${JSON.stringify(json.errors)}`);
  }

  return json.data as T;
}
