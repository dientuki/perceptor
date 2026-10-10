import { SourceStatus } from '@prisma/client';

import { mapTorrentState } from './client';

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
