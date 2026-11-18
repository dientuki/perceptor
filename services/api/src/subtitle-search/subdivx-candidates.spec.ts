import { subdivxCandidates } from './subdivx-candidates';
import type { SubdivxItem } from '@/clients/subdivx/types';

// This suite exists because a wrong episode match stages a subtitle for
// another episode with no error anywhere, and sync might even accept it. It
// pins the matching rules: season/episode fields, SxxEyy in the text when the
// fields are null, season packs only after every exact match, and anything
// from another season dropped.
const item = (over: Partial<SubdivxItem> & { id: number }): SubdivxItem => ({
  title: 'Show',
  description: '',
  season: null,
  episode: null,
  downloads: 0,
  ...over,
});
const ids = (c: { id: string }[]) => c.map((x) => x.id);
const target = { season: 1, episode: 2 };

describe('subdivxCandidates', () => {
  it('matches by season and episode fields and drops other episodes', () => {
    const out = subdivxCandidates(
      [item({ id: 1, season: 1, episode: 2 }), item({ id: 2, season: 1, episode: 3 })],
      target,
      'Show.S01E02',
    );
    expect(ids(out)).toEqual(['1']);
  });

  it('matches SxxEyy in the description when the fields are null, word-bounded', () => {
    const out = subdivxCandidates(
      [
        item({ id: 1, description: 'Show.s01e02.720p' }),
        item({ id: 2, description: 'Show.S01E021.720p' }),
        item({ id: 3, title: 'Show S1E2 HDTV' }),
        item({ id: 4, description: 'Show.S11E02' }),
      ],
      target,
      'Show.S01E02.720p',
    );
    expect(ids(out).sort()).toEqual(['1', '3']);
  });

  it('ranks a season pack after exact matches even when it looks more similar', () => {
    const out = subdivxCandidates(
      [
        item({ id: 1, season: 1, episode: null, description: 'Show S01E02 720p WEB', downloads: 999 }),
        item({ id: 2, season: 1, episode: 2, description: 'other', downloads: 0 }),
      ],
      target,
      'Show S01E02 720p WEB',
    );
    expect(ids(out)).toEqual(['2', '1']);
  });

  it('drops a pack of another season', () => {
    const out = subdivxCandidates([item({ id: 1, season: 2, episode: null })], target, 'x');
    expect(out).toEqual([]);
  });

  it('keeps at most three', () => {
    const items = [1, 2, 3, 4, 5].map((id) => item({ id, season: 1, episode: 2 }));
    expect(subdivxCandidates(items, target, 'x')).toHaveLength(3);
  });

  it('passes a film through ranked by similarity, then downloads', () => {
    const out = subdivxCandidates(
      [
        item({ id: 1, description: 'Movie 2020 BluRay', downloads: 1 }),
        item({ id: 2, description: 'Movie 2020 WEB', downloads: 50 }),
      ],
      null,
      'Movie 2020 BluRay',
    );
    expect(ids(out)).toEqual(['1', '2']);
    expect(out[0]).toMatchObject({ fileCount: 1, hashMatch: false, release: 'Movie 2020 BluRay' });
  });
});
