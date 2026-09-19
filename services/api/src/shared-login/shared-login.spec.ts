/*
 * A shared-login push that reports success while qBittorrent or Prowlarr kept
 * the old password leaves the three logins silently out of sync, and the
 * operator only finds out when a login fails later.
 */
import {
  isSharedPasswordLongEnough,
  setProwlarrLogin,
  setQbittorrentLogin,
} from './shared-login';

const config = {
  torrent_host: 'torrent',
  torrent_port: '8080',
  tracker_host: 'indexer',
  tracker_port: '9696',
  tracker_api_key: 'key-123',
};
const PASSWORD = 'S3cret&pass word';

type Call = { url: string; init?: RequestInit };

function fakeFetch(
  handler: (call: Call) => { status: number; json?: unknown },
) {
  const calls: Call[] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    const call = { url: String(url), init };
    calls.push(call);
    const r = handler(call);
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.json,
    };
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('setQbittorrentLogin', () => {
  it('is ok when preferences read back with the new username', async () => {
    const { fn } = fakeFetch(({ url }) =>
      url.endsWith('/preferences')
        ? { status: 200, json: { web_ui_username: 'admin' } }
        : { status: 200 },
    );
    expect(await setQbittorrentLogin(config, 'admin', PASSWORD, fn)).toEqual({
      target: 'qbittorrent',
      ok: true,
    });
  });

  it('is not ok when setPreferences answers 200 but the username read back differs', async () => {
    const { fn } = fakeFetch(({ url }) =>
      url.endsWith('/preferences')
        ? { status: 200, json: { web_ui_username: 'old' } }
        : { status: 200 },
    );
    const result = await setQbittorrentLogin(config, 'admin', PASSWORD, fn);
    expect(result.ok).toBe(false);
  });

  it('is not ok and says unreachable when fetch throws', async () => {
    const fn = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const result = await setQbittorrentLogin(config, 'admin', PASSWORD, fn);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/inalcanzable/);
  });

  it('is not ok and carries the status when setPreferences answers 403', async () => {
    const { fn } = fakeFetch(() => ({ status: 403 }));
    const result = await setQbittorrentLogin(config, 'admin', PASSWORD, fn);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('403');
  });

  it('never puts the password in a requested URL', async () => {
    const { fn, calls } = fakeFetch(({ url }) =>
      url.endsWith('/preferences')
        ? { status: 200, json: { web_ui_username: 'admin' } }
        : { status: 200 },
    );
    await setQbittorrentLogin(config, 'admin', PASSWORD, fn);
    for (const c of calls) {
      expect(decodeURIComponent(c.url)).not.toContain(PASSWORD);
      expect(c.url).not.toContain(encodeURIComponent(PASSWORD));
    }
  });
});

describe('setProwlarrLogin', () => {
  it('is not ok and issues no PUT when the GET answers 401', async () => {
    const { fn, calls } = fakeFetch(() => ({ status: 401 }));
    const result = await setProwlarrLogin(config, 'admin', PASSWORD, fn);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('401');
    expect(calls.filter((c) => c.init?.method === 'PUT')).toHaveLength(0);
  });

  it('PUTs forms auth with password equal to passwordConfirmation and sends the api key', async () => {
    const { fn, calls } = fakeFetch(({ init }) =>
      init?.method === 'PUT'
        ? { status: 202 }
        : { status: 200, json: { id: 1, port: 9696 } },
    );
    const result = await setProwlarrLogin(config, 'admin', PASSWORD, fn);
    expect(result.ok).toBe(true);

    const put = calls.find((c) => c.init?.method === 'PUT')!;
    const body = JSON.parse(put.init!.body as string);
    expect(body).toMatchObject({
      id: 1,
      port: 9696,
      authenticationMethod: 'forms',
      authenticationRequired: 'enabled',
      username: 'admin',
    });
    expect(body.password).toBe(PASSWORD);
    expect(body.passwordConfirmation).toBe(PASSWORD);
    for (const c of calls) {
      expect((c.init?.headers as Record<string, string>)['X-Api-Key']).toBe(
        'key-123',
      );
    }
  });

  it('never puts the password in a requested URL', async () => {
    const { fn, calls } = fakeFetch(({ init }) =>
      init?.method === 'PUT' ? { status: 202 } : { status: 200, json: {} },
    );
    await setProwlarrLogin(config, 'admin', PASSWORD, fn);
    for (const c of calls) {
      expect(decodeURIComponent(c.url)).not.toContain(PASSWORD);
    }
  });
});

describe('isSharedPasswordLongEnough', () => {
  it('rejects five characters and accepts six, the threshold qBittorrent enforces', () => {
    expect(isSharedPasswordLongEnough('xxxxx')).toBe(false);
    expect(isSharedPasswordLongEnough('xxxxxx')).toBe(true);
  });
});
