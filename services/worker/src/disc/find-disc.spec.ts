// Defends against mis-recognising a disc: treating BDMV/BACKUP copies or a pile
// of loose .m2ts as a disc would pick a playlist that was never meant to be
// played, while missing a nested disc sends it down the "no video" path.

import { describe, expect, it } from 'vitest';
import { findDiscRoots } from './find-disc';

const R = '/downloads/Film.2020.BluRay';

describe('findDiscRoots', () => {
  it('finds a disc at the top of the download', () => {
    const roots = findDiscRoots([
      `${R}/BDMV/PLAYLIST/00000.mpls`,
      `${R}/BDMV/STREAM/00001.m2ts`,
      `${R}/BDMV/CLIPINF/00001.clpi`,
      `${R}/BDMV/index.bdmv`,
    ]);
    expect(roots).toHaveLength(1);
    expect(roots[0].root).toBe(R);
    expect(roots[0].playlists).toEqual([`${R}/BDMV/PLAYLIST/00000.mpls`]);
    expect(roots[0].clips).toEqual([`${R}/BDMV/STREAM/00001.m2ts`]);
  });

  it('finds a disc nested below the download path', () => {
    const nested = `${R}/Film.Disc/Inner`;
    const roots = findDiscRoots([`${nested}/BDMV/PLAYLIST/00000.mpls`, `${nested}/BDMV/STREAM/00001.m2ts`]);
    expect(roots.map((r) => r.root)).toEqual([nested]);
  });

  it('matches directory names and extensions case-insensitively', () => {
    const roots = findDiscRoots([`${R}/bdmv/playlist/00000.MPLS`, `${R}/BDMV/Stream/00001.M2TS`]);
    expect(roots).toHaveLength(1);
  });

  it('ignores BDMV/BACKUP', () => {
    expect(
      findDiscRoots([`${R}/BDMV/BACKUP/PLAYLIST/00000.mpls`, `${R}/BDMV/STREAM/00001.m2ts`]),
    ).toEqual([]);
  });

  it('does not count a disc with playlists but no clips, or clips but no playlists', () => {
    expect(findDiscRoots([`${R}/BDMV/PLAYLIST/00000.mpls`])).toEqual([]);
    expect(findDiscRoots([`${R}/BDMV/STREAM/00001.m2ts`])).toEqual([]);
  });

  it('reports two discs as two roots', () => {
    const roots = findDiscRoots([
      `${R}/Disc2/BDMV/PLAYLIST/00000.mpls`,
      `${R}/Disc2/BDMV/STREAM/00001.m2ts`,
      `${R}/Disc1/BDMV/PLAYLIST/00000.mpls`,
      `${R}/Disc1/BDMV/STREAM/00001.m2ts`,
    ]);
    expect(roots.map((r) => r.root)).toEqual([`${R}/Disc1`, `${R}/Disc2`]);
  });

  it('does not treat loose .m2ts with no BDMV tree as a disc (AC-8)', () => {
    expect(findDiscRoots([`${R}/STREAM/00001.m2ts`, `${R}/00002.m2ts`])).toEqual([]);
  });
});
