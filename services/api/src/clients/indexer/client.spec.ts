import { ProwlarrClient } from './client';
import { SettingsService } from '@/settings/settings.service';

// resolveInfoHash's third path (parsing a fetched .torrent buffer via the ESM-only
// `parse-torrent` package) isn't exercised here: Jest's default config runs code in a VM sandbox
// that rejects a real dynamic `import()` of an ESM package with
// `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG` unless `--experimental-vm-modules` is set, which
// this project's Jest config does not do — a pre-existing constraint, not something this fix
// changes. The magnet-redirect path below exercises the same "resolve instead of drop" logic
// with a real infoHash parsed from a real magnet URI, which is enough to prove the fix.

// This test exists because otherwise a failed indexer response (a 401 from a
// wrong tracker_api_key, a 5xx outage, a dead host) is parsed as if it were a
// list of releases: `res.json()` on a Prowlarr error body yields an object,
// `filterData` iterates whatever comes out, and the search silently comes
// back as "no releases found" instead of surfacing the real failure. That is
// indistinguishable from a title that was genuinely never released, and it
// would mask every other misconfiguration this feature can produce.
describe('ProwlarrClient.getData (via search)', () => {
  const settings = {
    getMap: jest.fn().mockResolvedValue({
      tracker_host: 'indexer',
      tracker_port: '9696',
      tracker_api_key: 'a-key',
    }),
  } as unknown as SettingsService;

  let client: ProwlarrClient;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    client = new ProwlarrClient(settings);
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('raises with the status code on a 401', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: 'Unauthorized' }),
    });

    await expect(client.search('dune')).rejects.toThrow(
      'Could not reach the indexer',
    );
  });

  it('raises with the status code on a 500', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ message: 'Internal Server Error' }),
    });

    await expect(client.search('dune')).rejects.toThrow(
      'Could not reach the indexer',
    );
  });

  it('raises the no-status message when fetch itself fails (connection refused)', async () => {
    fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(client.search('dune')).rejects.toThrow(
      'Could not reach the indexer',
    );
  });

  it('returns an empty list without raising on a successful empty response', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [],
    });

    await expect(client.search('dune')).resolves.toEqual([]);
  });
});

// This suite exists because an indexer like LimeTorrents populates neither `infoHash` nor
// `magnetUrl`, and its `guid` is a plain result-page URL with no embeddable hash. `filterData`
// used to have exactly one path for that shape — drop it — which made every LimeTorrents release
// vanish from every search, silently, with no error anywhere. The fix resolves the real infoHash
// from the item's own `downloadUrl` instead of discarding it; these tests fail if that path is
// ever removed or short-circuited again.
describe('ProwlarrClient.search — releases with no infoHash and no hash-bearing guid', () => {
  const settings = {
    getMap: jest.fn().mockResolvedValue({
      tracker_host: 'indexer',
      tracker_port: '9696',
      tracker_api_key: 'a-key',
    }),
  } as unknown as SettingsService;

  let client: ProwlarrClient;
  let fetchSpy: jest.SpyInstance;

  const limeTorrentsItem = {
    title:
      'Venom Let There Be Carnage 2021 2160p BluRay Remux DV HDR HEVC Atmos SGF',
    size: 58_200_000_000,
    seeders: 55,
    leechers: 15,
    guid: 'https://www.limetorrents.fun/Venom-Let-There-Be-Carnage-torrent-19908172.html',
    downloadUrl: 'https://www.limetorrents.fun/download/19908172/venom.torrent',
  };

  beforeEach(() => {
    client = new ProwlarrClient(settings);
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('keeps the release, resolving its infoHash from its own downloadUrl', async () => {
    const REAL_HASH = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
    fetchSpy.mockImplementation((url: unknown) => {
      if (String(url).includes('/api/v1/search')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [limeTorrentsItem],
        } as Response);
      }
      // Prowlarr's downloadUrl for LimeTorrents redirects to a magnet — resolveInfoHash's second
      // recovery path (before it would fall through to parsing a .torrent buffer).
      return Promise.resolve({
        ok: false,
        status: 302,
        headers: new Headers({
          location: `magnet:?xt=urn:btih:${REAL_HASH}&dn=${encodeURIComponent(limeTorrentsItem.title)}`,
        }),
      } as Response);
    });

    const result = await client.search('venom');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      title: limeTorrentsItem.title,
      seeders: 55,
      leechers: 15,
      // A real infoHash parsed from the magnet URI, not a placeholder — a fake one would silently
      // break completion matching, which happens exclusively by infoHash (services/api/CLAUDE.md's
      // downloads/ section).
      infoHash: REAL_HASH.toUpperCase(),
    });
  });

  it('drops just that release, not the whole search, when its downloadUrl never resolves', async () => {
    const otherItem = {
      title: 'Venom Let There Be Carnage 2021 1080p WEB-DL',
      size: 4_000_000_000,
      seeders: 10,
      leechers: 2,
      guid: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    };
    fetchSpy.mockImplementation((url: unknown) => {
      if (String(url).includes('/api/v1/search')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [limeTorrentsItem, otherItem],
        } as Response);
      }
      // The LimeTorrents download link is dead.
      return Promise.reject(new Error('ECONNRESET'));
    });

    const result = await client.search('venom');

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe(otherItem.title);
  });
});
