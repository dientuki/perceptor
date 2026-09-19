export type SharedLoginResult = {
  target: 'qbittorrent' | 'prowlarr';
  ok: boolean;
  reason?: string;
};

export const SHARED_PASSWORD_MIN_LENGTH = 6;

export function isSharedPasswordLongEnough(password: string): boolean {
  return password.length >= SHARED_PASSWORD_MIN_LENGTH;
}

type FetchFn = typeof fetch;

function unreachable(): SharedLoginResult['reason'] {
  return 'inalcanzable';
}

export async function setQbittorrentLogin(
  config: Record<string, string>,
  username: string,
  password: string,
  fetchFn: FetchFn = fetch,
): Promise<SharedLoginResult> {
  const target = 'qbittorrent' as const;
  const base = `http://${config['torrent_host']}:${config['torrent_port']}/api/v2/app`;

  try {
    // https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-5.0)#set-application-preferences
    const set = await fetchFn(`${base}/setPreferences`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        json: JSON.stringify({
          web_ui_username: username,
          web_ui_password: password,
        }),
      }).toString(),
    });
    if (!set.ok) return { target, ok: false, reason: `HTTP ${set.status}` };

    // https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-5.0)#get-application-preferences
    const read = await fetchFn(`${base}/preferences`);
    if (!read.ok) return { target, ok: false, reason: `HTTP ${read.status}` };

    const prefs = (await read.json()) as { web_ui_username?: string };
    if (prefs.web_ui_username !== username) {
      return {
        target,
        ok: false,
        reason: 'qBittorrent respondió 200 pero no aplicó el cambio',
      };
    }
    return { target, ok: true };
  } catch {
    return { target, ok: false, reason: unreachable() };
  }
}

export async function setProwlarrLogin(
  config: Record<string, string>,
  username: string,
  password: string,
  fetchFn: FetchFn = fetch,
): Promise<SharedLoginResult> {
  const target = 'prowlarr' as const;
  const url = `http://${config['tracker_host']}:${config['tracker_port']}/api/v1/config/host`;
  const headers = {
    'X-Api-Key': config['tracker_api_key'] ?? '',
    'Content-Type': 'application/json',
  };

  try {
    // https://prowlarr.com/docs/api/#/HostConfig/get_api_v1_config_host
    const current = await fetchFn(url, { headers });
    if (!current.ok) {
      return { target, ok: false, reason: `HTTP ${current.status}` };
    }
    const body = (await current.json()) as Record<string, unknown>;

    // https://prowlarr.com/docs/api/#/HostConfig/put_api_v1_config_host__id_
    const put = await fetchFn(url, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        ...body,
        authenticationMethod: 'forms',
        authenticationRequired: 'enabled',
        username,
        password,
        passwordConfirmation: password,
      }),
    });
    if (!put.ok) return { target, ok: false, reason: `HTTP ${put.status}` };
    return { target, ok: true };
  } catch {
    return { target, ok: false, reason: unreachable() };
  }
}
