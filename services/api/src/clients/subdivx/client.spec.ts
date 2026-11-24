import {
  parseContentDisposition,
  SubdivxCandidateFetchError,
  SubdivxClient,
} from './client';
import { SubtitleProviderHttpError } from '../subtitle-provider-error';

// This suite exists because the Subdivx error handling fails silently in
// three ways: a 401/403 read as a generic outage hides a wrong key behind a
// retry, a 429 waited out unbounded (or retried more than once) stalls the
// search driver, and a dead candidate (404/502 on download) read as a provider
// outage would abandon Subdivx instead of trying the next candidate. The key
// must also never reach an error message, since those land in logs and in a
// stored search row. The network is stubbed at `fetch`.
const KEY = 'fake-subdivx-key-77ac';

type Reply = { status: number; json?: unknown; headers?: Record<string, string>; bytes?: string };

const reply = ({ status, json, headers = {}, bytes }: Reply) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  json: () => Promise.resolve(json),
  arrayBuffer: () => Promise.resolve(new TextEncoder().encode(bytes ?? '').buffer),
});

class TestClient extends SubdivxClient {
  sleeps: number[] = [];
  protected override sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    return Promise.resolve();
  }
}

describe('SubdivxClient', () => {
  let fetchMock: jest.Mock;
  let client: TestClient;
  let map: Record<string, string>;

  beforeEach(() => {
    map = { subdivx_api_key: KEY };
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    client = new TestClient({ getMap: () => Promise.resolve(map) } as never);
  });

  const caught = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      return e as Error;
    }
    throw new Error('expected rejection');
  };

  it('sends the Bearer key, limit=200 and returns items', async () => {
    fetchMock.mockResolvedValue(reply({ status: 200, json: { items: [{ id: 1 }], total: 1 } }));
    const items = await client.search({ imdbId: 'tt0123', year: 1999 });
    expect(items).toEqual([{ id: 1 }]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/subtitles/search?');
    expect(url).toContain('imdb_id=tt0123');
    expect(url).toContain('limit=200');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
  });

  it.each([401, 403])('maps %i to unauthorized', async (status) => {
    fetchMock.mockResolvedValue(reply({ status }));
    const err = await caught(client.search({ query: 'x' }));
    expect(err).toBeInstanceOf(SubtitleProviderHttpError);
    expect((err as SubtitleProviderHttpError).kind).toBe('unauthorized');
  });

  it('retries a 429 once with a bounded wait, then reports rate_limited', async () => {
    fetchMock.mockResolvedValue(reply({ status: 429, headers: { 'retry-after': '3600' } }));
    const err = await caught(client.search({ query: 'x' }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(client.sleeps).toEqual([10_000]);
    expect((err as SubtitleProviderHttpError).kind).toBe('rate_limited');
  });

  it('succeeds when the single retry after a 429 works', async () => {
    fetchMock
      .mockResolvedValueOnce(reply({ status: 429, headers: { 'retry-after': '1' } }))
      .mockResolvedValueOnce(reply({ status: 200, json: { items: [] } }));
    await expect(client.search({ query: 'x' })).resolves.toEqual([]);
    expect(client.sleeps).toEqual([1000]);
  });

  it('maps other statuses and network errors to unavailable', async () => {
    fetchMock.mockResolvedValueOnce(reply({ status: 502 }));
    expect(((await caught(client.search({ query: 'x' }))) as SubtitleProviderHttpError).kind).toBe('unavailable');
    fetchMock.mockRejectedValueOnce(new Error(`boom ${KEY}`));
    const err = await caught(client.search({ query: 'x' }));
    expect((err as SubtitleProviderHttpError).kind).toBe('unavailable');
    expect(err.message).not.toContain(KEY);
  });

  it('treats a missing key as unauthorized without calling the network', async () => {
    map = {};
    const err = await caught(client.search({ query: 'x' }));
    expect((err as SubtitleProviderHttpError).kind).toBe('unauthorized');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([400, 404, 502])('reports a download %i as a candidate failure', async (status) => {
    fetchMock.mockResolvedValue(reply({ status }));
    const err = await caught(client.download(9));
    expect(err).toBeInstanceOf(SubdivxCandidateFetchError);
    expect(err.message).not.toContain(KEY);
  });

  it('keeps a download 401 as a provider error and leaks no key', async () => {
    fetchMock.mockResolvedValue(reply({ status: 401 }));
    const err = await caught(client.download(9));
    expect((err as SubtitleProviderHttpError).kind).toBe('unauthorized');
    expect(err.message).not.toContain(KEY);
  });

  it('returns bytes and the Content-Disposition file name', async () => {
    fetchMock.mockResolvedValue(
      reply({ status: 200, bytes: 'abc', headers: { 'content-disposition': 'attachment; filename="Show.S01E02.zip"' } }),
    );
    const out = await client.download(9);
    expect(out.bytes.toString()).toBe('abc');
    expect(out.fileName).toBe('Show.S01E02.zip');
  });
});

describe('parseContentDisposition', () => {
  it('handles quoted, bare, RFC 5987 and absent names, never a path', () => {
    expect(parseContentDisposition('attachment; filename="a b.srt"')).toBe('a b.srt');
    expect(parseContentDisposition('attachment; filename=a.srt')).toBe('a.srt');
    expect(parseContentDisposition("attachment; filename*=UTF-8''Pel%C3%ADcula.srt")).toBe('Película.srt');
    expect(parseContentDisposition('attachment; filename="../../evil.srt"')).toBe('evil.srt');
    expect(parseContentDisposition(null)).toBeNull();
    expect(parseContentDisposition('inline')).toBeNull();
  });
});
