// Defends against filing the wrong cut of a disc: decoy playlists, menu loops
// rolled out to film length and half-downloaded playlists all look like a valid
// "longest playlist". A wrong pick produces a completed job and a scrambled film.

import { describe, expect, it } from 'vitest';
import { selectPlaylist, TIE_WINDOW_TICKS, type PlaylistCandidate } from './select-playlist';

const MIN = 45_000 * 60;

function playlist(
  name: string,
  clips: Array<[string, number]>,
  entryMarkCount = 0,
  playable = true,
): PlaylistCandidate {
  return {
    name,
    items: clips.map(([clipName, ticks]) => ({ clipName, inTicks: 0, outTicks: ticks })),
    entryMarkCount,
    playable,
  };
}

describe('selectPlaylist', () => {
  it('picks the longest playlist', () => {
    const result = selectPlaylist([
      playlist('00000.mpls', [['00001', 10 * MIN]]),
      playlist('00001.mpls', [['00002', 100 * MIN]]),
      playlist('00002.mpls', [['00003', 30 * MIN]]),
    ]);
    expect(result).toMatchObject({ kind: 'match', playlist: { name: '00001.mpls' } });
  });

  it('sums every item of a multi-clip playlist', () => {
    const result = selectPlaylist([
      playlist('00000.mpls', [['00001', 70 * MIN]]),
      playlist('00001.mpls', [['00002', 40 * MIN], ['00003', 40 * MIN]]),
    ]);
    expect(result).toMatchObject({ kind: 'match', playlist: { name: '00001.mpls' } });
  });

  it('drops an unplayable playlist even when it is the longest', () => {
    const result = selectPlaylist([
      playlist('00000.mpls', [['00001', 200 * MIN]], 5, false),
      playlist('00001.mpls', [['00002', 100 * MIN]]),
    ]);
    expect(result).toMatchObject({ kind: 'match', playlist: { name: '00001.mpls' } });
  });

  it('drops a loop even when it is the longest and carries marks (AC-15)', () => {
    const loop = playlist('00001.mpls', [['00009', 20 * MIN], ['00009', 20 * MIN], ['00009', 20 * MIN], ['00009', 20 * MIN], ['00009', 20 * MIN], ['00009', 20 * MIN]], 12);
    const film = playlist('00002.mpls', [['00003', 60 * MIN], ['00004', 40 * MIN]], 20);
    expect(selectPlaylist([loop, film])).toMatchObject({
      kind: 'match',
      playlist: { name: '00002.mpls' },
    });
  });

  it('keeps a playlist whose distinct content is exactly half its total', () => {
    const half = playlist('00001.mpls', [['00001', 50 * MIN], ['00001', 50 * MIN]]);
    expect(selectPlaylist([half])).toMatchObject({ kind: 'match' });
  });

  it('breaks a tie in favour of the playlist with marks (AC-11)', () => {
    const decoy = playlist('00800.mpls', [['00001', 100 * MIN]], 0);
    const real = playlist('00801.mpls', [['00002', 100 * MIN]], 18);
    expect(selectPlaylist([decoy, real])).toMatchObject({
      kind: 'match',
      playlist: { name: '00801.mpls' },
    });
  });

  it('then breaks a tie by the most marks', () => {
    const few = playlist('00800.mpls', [['00001', 100 * MIN]], 3);
    const many = playlist('00801.mpls', [['00002', 100 * MIN]], 18);
    expect(selectPlaylist([few, many])).toMatchObject({
      kind: 'match',
      playlist: { name: '00801.mpls' },
    });
  });

  it('is ambiguous with sorted names when marks tie too (AC-13)', () => {
    const result = selectPlaylist([
      playlist('00801.mpls', [['00002', 100 * MIN]], 18),
      playlist('00800.mpls', [['00001', 100 * MIN]], 18),
    ]);
    expect(result).toEqual({ kind: 'ambiguous', playlists: ['00800.mpls', '00801.mpls'] });
  });

  it('is ambiguous when tied playlists all carry no marks', () => {
    const result = selectPlaylist([
      playlist('00001.mpls', [['00001', 100 * MIN]]),
      playlist('00000.mpls', [['00002', 100 * MIN]]),
    ]);
    expect(result).toEqual({ kind: 'ambiguous', playlists: ['00000.mpls', '00001.mpls'] });
  });

  it('treats exactly 1 s apart as a tie and 1 s plus a tick as a clear winner', () => {
    const base = 100 * MIN;
    const atBoundary = selectPlaylist([
      playlist('00000.mpls', [['00001', base]], 0),
      playlist('00001.mpls', [['00002', base - TIE_WINDOW_TICKS]], 9),
    ]);
    expect(atBoundary).toMatchObject({ kind: 'match', playlist: { name: '00001.mpls' } });

    const beyond = selectPlaylist([
      playlist('00000.mpls', [['00001', base]], 0),
      playlist('00001.mpls', [['00002', base - TIE_WINDOW_TICKS - 1]], 9),
    ]);
    expect(beyond).toMatchObject({ kind: 'match', playlist: { name: '00000.mpls' } });
  });

  it('does not let a marked playlist outside the window beat the longest', () => {
    const result = selectPlaylist([
      playlist('00000.mpls', [['00001', 120 * MIN]], 0),
      playlist('00001.mpls', [['00002', 90 * MIN]], 30),
    ]);
    expect(result).toMatchObject({ kind: 'match', playlist: { name: '00000.mpls' } });
  });

  it('returns none when every playlist is dropped', () => {
    expect(
      selectPlaylist([
        playlist('00000.mpls', [['00001', 100 * MIN]], 3, false),
        playlist('00001.mpls', [['00002', 10 * MIN], ['00002', 10 * MIN], ['00002', 10 * MIN]]),
      ]),
    ).toEqual({ kind: 'none' });
  });

  it('returns none for no playlists and for an empty playlist', () => {
    expect(selectPlaylist([])).toEqual({ kind: 'none' });
    expect(selectPlaylist([playlist('00000.mpls', [])])).toEqual({ kind: 'none' });
  });
});
