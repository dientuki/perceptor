import { OpenSubtitlesClient } from './client';
import { OpenSubtitlesHttpError } from './errors';

// This suite exists because the OpenSubtitles error handling fails silently
// in four ways: a 401 loop that never stops re-logging in burns the account's
// login limit, a 429 waited out unbounded stalls the search driver for
// minutes, a 406 on download read as a generic failure hides the exhausted
// daily quota behind a retry, and an error message that echoes the password
// or the application key lands in the log and in a stored search row. The
// network is stubbed at `fetch`; the Redis token cache is a real Map-backed
// fake so the reuse and invalidation rules are exercised, not mocked away.
const KEY = 'fake-application-key-8f3a';
const USER = 'fake-user';
const PASSWORD = 'fake-password-c91d';

type Reply = {
  status: number;
  json?: unknown;
  headers?: Record<string, string>;
  bytes?: string;
};

const reply = ({ status, json, headers = {}, bytes }: Reply) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  json: () => Promise.resolve(json),
  arrayBuffer: () =>
    Promise.resolve(new TextEncoder().encode(bytes ?? '').buffer),
});

const LOGIN_OK: Reply = {
  status: 200,
  json: { token: 'tok-1', base_url: 'api.opensubtitles.com' },
};

describe('OpenSubtitlesClient', () => {
  const savedKey = process.env.OPENSUBTITLES_API_KEY;
  let store: Map<string, string>;
  let settingsMap: Record<string, string>;
  let fetchMock: jest.Mock;
  let sleeps: number[];
  let client: OpenSubtitlesClient;

  const calls = (needle: string) =>
    fetchMock.mock.calls.filter(([url]) => String(url).includes(needle));

  beforeEach(() => {
    process.env.OPENSUBTITLES_API_KEY = KEY;
    store = new Map();
    settingsMap = {
      opensubtitles_username: USER,
      opensubtitles_password: PASSWORD,
    };
    sleeps = [];
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const redis = {
      get: (k: string) => Promise.resolve(store.get(k) ?? null),
      set: (k: string, v: string) => {
        store.set(k, v);
        return Promise.resolve('OK');
      },
      del: (k: string) => {
        store.delete(k);
        return Promise.resolve(1);
      },
    };
    client = new OpenSubtitlesClient(redis as never, {
      getMap: () => Promise.resolve(settingsMap),
    } as never);
    (client as unknown as { sleep: (ms: number) => Promise<void> }).sleep = (
      ms,
    ) => {
      sleeps.push(ms);
      return Promise.resolve();
    };
  });

  afterEach(() => {
    if (savedKey === undefined) delete process.env.OPENSUBTITLES_API_KEY;
    else process.env.OPENSUBTITLES_API_KEY = savedKey;
  });

  const caught = async (call: () => Promise<unknown>) => {
    try {
      await call();
    } catch (error) {
      return error as OpenSubtitlesHttpError;
    }
    throw new Error('expected a rejection');
  };

  const searchOk: Reply = {
    status: 200,
    json: {
      data: [
        {
          attributes: {
            release: 'Film.2020.1080p',
            download_count: 7,
            moviehash_match: true,
            files: [{ file_id: 42, file_name: 'Film.2020.es.srt' }, { file_id: 43 }],
          },
        },
      ],
    },
  };

  it('logs in once, sends the identifying headers and maps a result', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(LOGIN_OK))
      .mockResolvedValueOnce(reply(searchOk));
    const found = await client.search({ tmdbId: 1, languages: 'es' });

    expect(found).toEqual([
      expect.objectContaining({
        id: '42',
        fileCount: 2,
        release: 'Film.2020.1080p',
        hashMatch: true,
        downloadCount: 7,
        fileName: 'Film.2020.es.srt',
      }),
    ]);
    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Api-Key']).toBe(KEY);
    expect(headers['User-Agent']).toMatch(/^Perceptor v\d+\.\d+\.\d+/);
    expect(headers.Authorization).toBe('Bearer tok-1');
  });

  it('re-logs in once after a 401 and throws unauthorized on a second 401 with exactly two logins', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        reply(String(url).endsWith('/login') ? LOGIN_OK : { status: 401 }),
      ),
    );
    const error = await caught(() =>
      client.search({ tmdbId: 1, languages: 'es' }),
    );
    expect(error.kind).toBe('unauthorized');
    expect(calls('/login')).toHaveLength(2);
    expect(calls('/subtitles')).toHaveLength(2);
  });

  it('recovers when the retry after a 401 succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(LOGIN_OK))
      .mockResolvedValueOnce(reply({ status: 401 }))
      .mockResolvedValueOnce(reply(LOGIN_OK))
      .mockResolvedValueOnce(reply(searchOk));
    await expect(
      client.search({ tmdbId: 1, languages: 'es' }),
    ).resolves.toHaveLength(1);
  });

  it('waits at most 10 seconds on a 429 and retries once', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(LOGIN_OK))
      .mockResolvedValueOnce(
        reply({ status: 429, headers: { 'retry-after': '3600' } }),
      )
      .mockResolvedValueOnce(reply(searchOk));
    await client.search({ tmdbId: 1, languages: 'es' });
    expect(sleeps).toEqual([10_000]);
    expect(calls('/subtitles')).toHaveLength(2);
  });

  it('throws rate_limited after a second 429', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        reply(
          String(url).endsWith('/login') ? LOGIN_OK : { status: 429 },
        ),
      ),
    );
    const error = await caught(() =>
      client.search({ tmdbId: 1, languages: 'es' }),
    );
    expect(error.kind).toBe('rate_limited');
    expect(calls('/subtitles')).toHaveLength(2);
  });

  it('reads a 406 on download as quota', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(LOGIN_OK))
      .mockResolvedValueOnce(reply({ status: 406 }));
    const error = await caught(() => client.download('42'));
    expect(error.kind).toBe('quota');
    expect(error.status).toBe(406);
  });

  it('maps a 5xx and a network failure to unavailable', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(LOGIN_OK))
      .mockResolvedValueOnce(reply({ status: 503 }));
    expect((await caught(() => client.search({ tmdbId: 1, languages: 'es' }))).kind).toBe('unavailable');

    fetchMock.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    expect((await caught(() => client.search({ tmdbId: 1, languages: 'es' }))).kind).toBe('unavailable');
  });

  it('downloads the link and reports the remaining quota', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(LOGIN_OK))
      .mockResolvedValueOnce(
        reply({ status: 200, json: { link: 'https://dl.example/x.srt', remaining: 0 } }),
      )
      .mockResolvedValueOnce(reply({ status: 200, bytes: '1\n00:00:01,000' }));
    const out = await client.download('42');
    expect(out.remaining).toBe(0);
    expect(out.bytes.toString()).toBe('1\n00:00:01,000');
    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      file_id: 42,
      sub_format: 'srt',
    });
  });

  it('reuses the cached token across calls and misses it after a credential change', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        reply(String(url).endsWith('/login') ? LOGIN_OK : searchOk),
      ),
    );
    await client.search({ tmdbId: 1, languages: 'es' });
    await client.search({ tmdbId: 1, languages: 'en' });
    expect(calls('/login')).toHaveLength(1);

    settingsMap.opensubtitles_password = 'another-fake-password';
    await client.search({ tmdbId: 1, languages: 'en' });
    expect(calls('/login')).toHaveLength(2);
  });

  it('never puts the password or the application key in an error message', async () => {
    const scenarios: Array<(url: string) => Reply> = [
      () => ({ status: 401 }),
      (url) => (url.endsWith('/login') ? LOGIN_OK : { status: 401 }),
      (url) => (url.endsWith('/login') ? LOGIN_OK : { status: 429 }),
      (url) => (url.endsWith('/login') ? LOGIN_OK : { status: 406 }),
      (url) => (url.endsWith('/login') ? LOGIN_OK : { status: 500, json: { message: `${KEY} ${PASSWORD}` } }),
    ];
    for (const scenario of scenarios) {
      store.clear();
      fetchMock.mockReset();
      fetchMock.mockImplementation((url: string) =>
        Promise.resolve(reply(scenario(String(url)))),
      );
      for (const call of [
        () => client.search({ tmdbId: 1, languages: 'es' }),
        () => client.download('42'),
      ]) {
        const error = await caught(call);
        expect(error.message).not.toContain(PASSWORD);
        expect(error.message).not.toContain(KEY);
        expect(JSON.stringify(error)).not.toContain(PASSWORD);
        expect(JSON.stringify(error)).not.toContain(KEY);
      }
    }

    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new Error(`boom ${KEY} ${PASSWORD}`));
    const error = await caught(() => client.search({ tmdbId: 1, languages: 'es' }));
    expect(error.message).not.toContain(PASSWORD);
    expect(error.message).not.toContain(KEY);
  });
});
