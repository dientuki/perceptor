import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { TorrentClientError } from '@/clients/torrent/client';
import { ERROR_KEYS } from '@/i18n/error-keys';
import { describeTorrentClientFailure, torrentClientFailure } from './torrent-client-failure';

// A wrong TORRENT_API_KEY must not be laundered into the generic "rejected (403)"
// message, and a live read's log must keep the reason. Otherwise an operator cannot
// tell a key mismatch from qBittorrent being down, and nothing anywhere says so.
describe('torrentClientFailure', () => {
  const body = (e: HttpException) => e.getResponse() as { i18n: { key: string; params?: unknown } };

  it.each([401, 403])('maps HTTP %i to the unauthorized key with no params', (status) => {
    const e = torrentClientFailure(new TorrentClientError('x', status));
    expect(e).toBeInstanceOf(ServiceUnavailableException);
    expect(body(e).i18n.key).toBe(ERROR_KEYS.TORRENT_CLIENT_UNAUTHORIZED);
    expect(body(e).i18n.params).toBeUndefined();
  });

  it('maps any other status to rejected with that status', () => {
    const e = torrentClientFailure(new TorrentClientError('x', 500));
    expect(body(e).i18n.key).toBe(ERROR_KEYS.TORRENT_CLIENT_REJECTED);
    expect(body(e).i18n.params).toEqual({ status: 500 });
  });

  it('maps an unreachable client (not a TorrentClientError) to rejected with status 0', () => {
    const e = torrentClientFailure(new TypeError('fetch failed'));
    expect(body(e).i18n.key).toBe(ERROR_KEYS.TORRENT_CLIENT_REJECTED);
    expect(body(e).i18n.params).toEqual({ status: 0 });
  });
});

describe('describeTorrentClientFailure', () => {
  const SENTINEL = 'sentinel-key-do-not-leak-0123';
  const saved = process.env.TORRENT_API_KEY;
  beforeEach(() => { process.env.TORRENT_API_KEY = SENTINEL; });
  afterEach(() => {
    if (saved === undefined) delete process.env.TORRENT_API_KEY;
    else process.env.TORRENT_API_KEY = saved;
  });

  it.each([401, 403])('names TORRENT_API_KEY for HTTP %i and never contains the key', (status) => {
    const text = describeTorrentClientFailure(new TorrentClientError('x', status));
    expect(text).toContain('TORRENT_API_KEY');
    expect(text).toContain(String(status));
    expect(text).not.toContain(SENTINEL);
  });

  it('returns the error message for other failures', () => {
    expect(describeTorrentClientFailure(new TorrentClientError('boom', 500))).toBe('boom');
  });
});
