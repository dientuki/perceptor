// Defends against filing the wrong cut of a real disc: a menu or loop playlist
// built from a couple of short clips repeated can out-run the film on raw
// duration. Parses real .mpls files, not synthetic buffers, so a parser or
// selector drift shows up as a completed job with the wrong file.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseMpls } from './mpls';
import { selectPlaylist, type PlaylistCandidate } from './select-playlist';

// Spec 100, T014
const DIR = join(__dirname, '../../fixtures/bdmv/transformers-the-movie-1986/PLAYLIST');
const TICKS_PER_MINUTE = 45_000 * 60;

function load(name: string): PlaylistCandidate {
  const parsed = parseMpls(readFileSync(join(DIR, name)));
  return { name, items: parsed.items, entryMarkCount: parsed.entryMarkCount, playable: true };
}

function total(candidate: PlaylistCandidate): number {
  return candidate.items.reduce((sum, item) => sum + (item.outTicks - item.inTicks), 0);
}

describe('selectPlaylist on a real disc (transformers-the-movie-1986)', () => {
  const candidates = ['00000.mpls', '00001.mpls', '00002.mpls', '00003.mpls'].map(load);
  const byName = new Map(candidates.map((candidate) => [candidate.name, candidate]));

  it('parses 00002.mpls as the 85 minute feature with 13 entry marks over clip 00006', () => {
    const feature = byName.get('00002.mpls')!;
    expect(feature.entryMarkCount).toBe(13);
    expect(new Set(feature.items.map((item) => item.clipName))).toEqual(new Set(['00006']));
    expect(Math.round(total(feature) / TICKS_PER_MINUTE)).toBe(85);
  });

  it('parses 00001.mpls as clip 00002 once plus clip 00003 four times', () => {
    const loop = byName.get('00001.mpls')!;
    const counts = new Map<string, number>();
    for (const item of loop.items) counts.set(item.clipName, (counts.get(item.clipName) ?? 0) + 1);
    expect(counts.get('00002')).toBe(1);
    expect(counts.get('00003')).toBe(4);
  });

  it('selects 00002.mpls as the winner', () => {
    const selection = selectPlaylist(candidates);
    expect(selection.kind).toBe('match');
    if (selection.kind === 'match') expect(selection.playlist.name).toBe('00002.mpls');
  });

  it('discards the looping 00001.mpls on its own and still picks the feature beside it', () => {
    expect(selectPlaylist([byName.get('00001.mpls')!]).kind).toBe('none');
    const both = selectPlaylist([byName.get('00001.mpls')!, byName.get('00002.mpls')!]);
    expect(both.kind === 'match' ? both.playlist.name : null).toBe('00002.mpls');
  });
});
