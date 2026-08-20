import { ProwlarrClient } from './client';
import { SettingsService } from '@/settings/settings.service';

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
    } as Response);

    await expect(client.search('dune')).rejects.toThrow('Could not reach the indexer');
  });

  it('raises with the status code on a 500', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ message: 'Internal Server Error' }),
    } as Response);

    await expect(client.search('dune')).rejects.toThrow('Could not reach the indexer');
  });

  it('raises the no-status message when fetch itself fails (connection refused)', async () => {
    fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(client.search('dune')).rejects.toThrow('Could not reach the indexer');
  });

  it('returns an empty list without raising on a successful empty response', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [],
    } as Response);

    await expect(client.search('dune')).resolves.toEqual([]);
  });
});
