// Defends the shape of NFR-2 (docs/spec/features/002-auth-login/spec.md): an
// auth failure, or any transport failure, must fail the BullMQ job loudly
// rather than being swallowed. Three classes of bug this guards against:
//   1. A 401 (or any error) response body is ignored because only json.errors
//      was checked, and the job silently reports success.
//   2. SERVICE_TOKEN is absent and the worker sends an anonymous request
//      instead of failing before any network call is made.
//   3. A non-2xx response with a non-JSON body (e.g. an HTML error page from
//      a proxy) makes res.json() throw an opaque SyntaxError instead of a
//      legible error naming the HTTP status.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchGraphQL } from './graphql-client';

const ORIGINAL_ENV = { ...process.env };

function setEnv(url?: string, token?: string) {
  if (url === undefined) delete process.env.INTERNAL_GRAPHQL_URL;
  else process.env.INTERNAL_GRAPHQL_URL = url;

  if (token === undefined) delete process.env.SERVICE_TOKEN;
  else process.env.SERVICE_TOKEN = token;
}

describe('fetchGraphQL', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllGlobals();
  });

  it('throws on a 401 response body carrying GraphQL errors, instead of swallowing it', async () => {
    setEnv('http://api:4000/graphql', 'service-token');

    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 401,
      text: async () =>
        JSON.stringify({ errors: [{ message: 'No autenticado' }] }),
      json: async () => ({ errors: [{ message: 'No autenticado' }] }),
    });

    await expect(fetchGraphQL('{ me { id } }')).rejects.toThrow();
  });

  it('throws synchronously at call time when SERVICE_TOKEN is missing, before any fetch is attempted', async () => {
    setEnv('http://api:4000/graphql', undefined);

    await expect(fetchGraphQL('{ me { id } }')).rejects.toThrow(
      /SERVICE_TOKEN/,
    );

    expect(fetch).not.toHaveBeenCalled();
  });

  it('throws a legible error, not a raw SyntaxError, on a non-2xx response with a non-JSON body', async () => {
    setEnv('http://api:4000/graphql', 'service-token');

    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '<html><body>Unauthorized</body></html>',
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON at position 0');
      },
    });

    let caught: unknown;
    try {
      await fetchGraphQL('{ me { id } }');
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(SyntaxError);
    expect((caught as Error).message).toMatch(/401/);
  });

  it('succeeds and sends the Authorization header when SERVICE_TOKEN is present', async () => {
    setEnv('http://api:4000/graphql', 'service-token');

    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { ok: true } }),
    });

    const result = await fetchGraphQL<{ ok: boolean }>('{ ok }');
    expect(result).toEqual({ ok: true });

    const call = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const headers = call[1].headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer service-token');
  });
});
