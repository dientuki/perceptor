import { SourceStatus } from '@prisma/client';

import { mapTorrentState, QbittorrentClient } from './client';

// Before 089-status-materialization, qbittorrent's "queuedDL" state (a torrent
// queued for download but not yet transferring) was folded into
// DOWNLOADING_STATES, so a title sitting in qBittorrent's queue read as
// actively downloading — indistinguishable from a torrent really pulling
// bytes. This defends the split: "queued" and "downloading" must map to two
// different SourceStatus values, and the unrelated 037 regression guard
// (an unrecognised state logging and falling back to DOWNLOADING rather than
// ERROR) must survive the refactor untouched.
describe('mapTorrentState', () => {
  const NOT_COMPLETED = -1;

  it('maps queuedDL to QUEUED', () => {
    expect(mapTorrentState('queuedDL', NOT_COMPLETED)).toBe(SourceStatus.QUEUED);
  });

  it.each([
    'stalledDL',
    'metaDL',
    'allocating',
    'checkingDL',
    'checkingResumeData',
    'forcedDL',
  ])('maps %s to DOWNLOADING', (state) => {
    expect(mapTorrentState(state, NOT_COMPLETED)).toBe(SourceStatus.DOWNLOADING);
  });

  it('maps an unrecognised state to DOWNLOADING with a loud log, never ERROR', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(mapTorrentState('somethingNew', NOT_COMPLETED)).toBe(SourceStatus.DOWNLOADING);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('somethingNew'));

    errorSpy.mockRestore();
  });

  it('maps a completed torrent (completion_on set) to READY regardless of state', () => {
    expect(mapTorrentState('uploading', 1700000000)).toBe(SourceStatus.READY);
  });
});

// Spec 104, T005. qBittorrent now authenticates by API key instead of by
// subnet. A method that forgets the Authorization header is answered 403 by
// qBittorrent, and setSavePath in particular never reads its response, so the
// failure would be silent: the save path simply would not change.
describe('QbittorrentClient authentication', () => {
  const SENTINEL = 'sentinel-torrent-key';
  const originalKey = process.env.TORRENT_API_KEY;
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  function client() {
    const settings = {
      getMap: async () => ({
        torrent_host: 'torrent',
        torrent_port: '8080',
        path_downloads: '.',
      }),
    };
    const mediaRoots = { resolveFromRoot: async () => '/downloads' };
    return new QbittorrentClient(settings as never, mediaRoots as never);
  }

  beforeEach(() => {
    process.env.TORRENT_API_KEY = SENTINEL;
    fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [],
      text: async () => '',
    }));
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.TORRENT_API_KEY;
    else process.env.TORRENT_API_KEY = originalKey;
  });

  const calls: [string, (c: QbittorrentClient) => Promise<unknown>][] = [
    ['info', (c) => c.info()],
    ['files', (c) => c.files('abc')],
    ['add', (c) => c.add(['magnet:?xt=urn:btih:abc'])],
    ['start', (c) => c.start('abc')],
    ['stop', (c) => c.stop('abc')],
    ['remove', (c) => c.remove('abc')],
    ['setSavePath', (c) => c.setSavePath('/downloads')],
  ];

  it.each(calls)('%s sends the bearer key', async (_name, call) => {
    await call(client());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.headers).toEqual(
      expect.objectContaining({ Authorization: `Bearer ${SENTINEL}` }),
    );
  });

  it('sends no Authorization header when the key is unset', async () => {
    delete process.env.TORRENT_API_KEY;
    await client().start('abc');

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.headers).not.toHaveProperty('Authorization');
  });
});
