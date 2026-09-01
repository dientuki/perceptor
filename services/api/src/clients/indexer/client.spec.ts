import { ProwlarrClient } from './client';
import { SettingsService } from '@/settings/settings.service';

// resolveInfoHash's third path (parsing a fetched .torrent buffer via the ESM-only
// `parse-torrent` package) isn't exercised here or in `resolve-info-hash.spec.ts`: Jest's default
// config runs code in a VM sandbox that rejects a real dynamic `import()` of an ESM package with
// `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG` unless `--experimental-vm-modules` is set, which
// this project's Jest config does not do — a pre-existing constraint, not something this fix
// changes.

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
// used to try to resolve that shape by fetching every such release's own `downloadUrl` during the
// search itself — fired all at once, through one Prowlarr instance, each capped at an 8s
// `AbortController`. Whatever did not settle in time was silently dropped, which made whole
// indexers vanish from every search with no error anywhere, and pinned every search at an ~8.1s
// floor to throw away most of what it fetched (`037-indexer-result-loss`). The fix stops
// resolving anything during a search: a release with no infoHash is still returned, grouped by a
// derived key, with `infoHash: null` — resolution happens lazily, once, when the release is
// added. These tests fail if a hash-less release is ever dropped or if a search issues a fetch
// beyond the single Prowlarr call again.
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

  it('keeps the release with infoHash: null and no fetch beyond the Prowlarr call, even when its downloadUrl would never resolve', async () => {
    fetchSpy.mockImplementation((url: unknown) => {
      if (String(url).includes('/api/v1/search')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [limeTorrentsItem],
        } as Response);
      }
      throw new Error(
        `unexpected fetch during search: ${String(url)} — a search must issue no request beyond Prowlarr's own`,
      );
    });

    const result = await client.search('venom');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      title: limeTorrentsItem.title,
      seeders: 55,
      leechers: 15,
      infoHash: null,
    });
    expect(result[0].id).toEqual(expect.any(String));
    expect(result[0].id.length).toBeGreaterThan(0);
  });

  it('collapses two hash-less releases from different indexers into one row with summed seeders, when title and size match', async () => {
    const duplicateFromAnotherIndexer = {
      ...limeTorrentsItem,
      guid: 'https://another-indexer.example/venom-19908172.html',
      downloadUrl: 'https://another-indexer.example/download/19908172/venom.torrent',
      seeders: 20,
      leechers: 5,
    };
    fetchSpy.mockImplementation((url: unknown) => {
      if (String(url).includes('/api/v1/search')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [limeTorrentsItem, duplicateFromAnotherIndexer],
        } as Response);
      }
      throw new Error(`unexpected fetch during search: ${String(url)}`);
    });

    const result = await client.search('venom');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      infoHash: null,
      seeders: 75,
      leechers: 20,
    });
  });

  it('keeps a release with a real infoHash and a hash-less release both, unrelated to each other', async () => {
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
      throw new Error(`unexpected fetch during search: ${String(url)}`);
    });

    const result = await client.search('venom');

    expect(result).toHaveLength(2);
    const titles = result.map((r) => r.title);
    expect(titles).toContain(limeTorrentsItem.title);
    expect(titles).toContain(otherItem.title);
    const otherResult = result.find((r) => r.title === otherItem.title);
    expect(otherResult?.infoHash).toBe('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  });
});
