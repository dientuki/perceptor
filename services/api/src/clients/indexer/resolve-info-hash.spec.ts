import { HttpException } from '@nestjs/common';

import { ERROR_KEYS, ErrorKey } from '@/i18n/error-keys';

import { resolveInfoHash } from './resolve-info-hash';

// resolveInfoHash's third path (parsing a fetched .torrent buffer via the ESM-only
// `parse-torrent` package) isn't exercised here: Jest's default config runs code in a VM sandbox
// that rejects a real dynamic `import()` of an ESM package with
// `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG` unless `--experimental-vm-modules` is set, which
// this project's Jest config does not do — a pre-existing constraint, not something this feature
// introduces. The magnet-redirect path below exercises the same resolve-or-throw contract with a
// real infoHash parsed from a real magnet URI, which is enough to prove it.

// This suite exists because the caller of resolveInfoHash is now always a deliberate user click
// on `addTorrentToMovie`/`addTorrentToEpisode` (`037-indexer-result-loss`): if this ever resolves
// to a falsy or empty hash instead of throwing, `attachTorrentSource` writes a `MediaSource` row
// whose infoHash qBittorrent will never report, and the download sits in `DOWNLOADING` forever
// with no error anywhere (`downloads.service.ts::handleTorrentCompleted` matches by hash alone).
// If it silently returns nothing for a dead link instead of throwing, the click the user made is
// lost with no feedback at all.
function expectI18nKey(fn: () => Promise<unknown>, key: ErrorKey): Promise<void> {
  return fn().then(
    () => {
      throw new Error('expected fn to reject');
    },
    (error) => {
      expect(error).toBeInstanceOf(HttpException);
      const response = (error as HttpException).getResponse() as {
        i18n?: { key: string };
      };
      expect(response.i18n?.key).toBe(key);
    },
  );
}

describe('resolveInfoHash', () => {
  let fetchSpy: jest.SpyInstance;

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  it('resolves a hash parsed directly from a magnet URL, with no fetch at all', async () => {
    const HASH = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
    fetchSpy = jest.spyOn(global, 'fetch');

    const result = await resolveInfoHash([`magnet:?xt=urn:btih:${HASH}&dn=Test`]);

    expect(result).toBe(HASH);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('follows a magnet redirect from a plain download URL', async () => {
    const HASH = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 302,
      headers: new Headers({
        location: `magnet:?xt=urn:btih:${HASH}&dn=Test`,
      }),
    } as Response);

    const result = await resolveInfoHash([
      'https://indexer.example/download/1.torrent',
    ]);

    expect(result).toBe(HASH);
  });

  it('tries the next URL when the first one fails', async () => {
    const HASH = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((url: unknown) => {
      if (String(url).includes('dead')) {
        return Promise.reject(new Error('ECONNRESET'));
      }
      return Promise.resolve({
        ok: false,
        status: 301,
        headers: new Headers({
          location: `magnet:?xt=urn:btih:${HASH}&dn=Test`,
        }),
      } as Response);
    });

    const result = await resolveInfoHash([
      'https://dead.example/download/1.torrent',
      'https://alive.example/download/1.torrent',
    ]);

    expect(result).toBe(HASH);
  });

  it('throws INDEXER_NO_INFOHASH when every URL fails', async () => {
    fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('ECONNRESET'));

    await expectI18nKey(
      () =>
        resolveInfoHash([
          'https://dead.example/a.torrent',
          'https://dead.example/b.torrent',
        ]),
      ERROR_KEYS.INDEXER_NO_INFOHASH,
    );
  });

  it('throws INDEXER_NO_INFOHASH when given no URLs at all', async () => {
    await expectI18nKey(() => resolveInfoHash([]), ERROR_KEYS.INDEXER_NO_INFOHASH);
  });
});
