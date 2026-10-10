import { KeyedError } from '../i18n/keyed-error';

// Spec 038, REQ-1 REQ-2 REQ-3 REQ-4
export class ApiUnreachableError extends Error {
  constructor(cause: unknown) {
    super(
      `could not reach api: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = 'ApiUnreachableError';
    this.cause = cause;
  }
}

interface GraphQLErrorEntry {
  message?: string;
  extensions?: {
    i18n?: {
      key?: string;
      params?: Record<string, string | number>;
    };
  };
}

export async function fetchGraphQL<T = unknown>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const url = process.env.INTERNAL_GRAPHQL_URL;
  if (!url) throw new Error('INTERNAL_GRAPHQL_URL is not defined');

  const token = process.env.SERVICE_TOKEN;
  if (!token) throw new Error('SERVICE_TOKEN is not defined');

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (err) {
    throw new ApiUnreachableError(err);
  }

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
    const [first] = json.errors as GraphQLErrorEntry[];
    const i18n = first?.extensions?.i18n;
    if (i18n?.key) {
      throw new KeyedError(
        i18n.key,
        first?.message ?? i18n.key,
        i18n.params,
      );
    }
    throw new Error(`GraphQL error: ${first?.message ?? JSON.stringify(json.errors)}`);
  }

  return json.data as T;
}
