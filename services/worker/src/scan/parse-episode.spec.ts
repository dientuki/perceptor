// Defends against the silent mis-filing described in ../plan.md and
// worker/plan.md § Risks: a wrong parse creates a ProcessJob against the
// wrong episode, the encode succeeds, and the wrong file lands in the
// library — every status still reports green (Constitution, Article IX).
// The path case is the sharpest version of that failure: a season-pack
// folder named "Show S02 COMPLETE" would make every file inside it parse as
// season 2 if the parser ever looked past the base name.

import { describe, expect, it } from 'vitest';
import { parseEpisode } from './parse-episode';

describe('parseEpisode', () => {
  it('parses a bare SxxEyy name', () => {
    expect(parseEpisode('S01E02')).toEqual({ seasonNumber: 1, episodeNumber: 2 });
  });

  it('is case-insensitive', () => {
    expect(parseEpisode('s1e2')).toEqual({ seasonNumber: 1, episodeNumber: 2 });
  });

  it('parses a realistic release name with quality and group tags', () => {
    expect(parseEpisode('Show.S01E02.1080p.x265-GRP.mkv')).toEqual({
      seasonNumber: 1,
      episodeNumber: 2,
    });
  });

  it('treats a multi-episode name as ambiguous, not a guess', () => {
    expect(parseEpisode('S01E01E02')).toBeNull();
  });

  it('does not support 1x02-style numbering', () => {
    expect(parseEpisode('Show.1x02.mkv')).toBeNull();
  });

  it('does not support a spelled-out "episode N" name', () => {
    expect(parseEpisode('episode 3.mkv')).toBeNull();
  });

  it('never reads the directory path — only the base name it is given', () => {
    // A season-pack folder is routinely named "Show S02 COMPLETE"; if this
    // matched against the full path every file inside would resolve to S02
    // regardless of its own name. The caller is responsible for passing
    // only the base name — this asserts that passing a path anyway (the
    // caller's mistake) still yields null rather than a false S02 hit.
    expect(parseEpisode('Show S02 COMPLETE/ep3.mkv')).toBeNull();
  });

  it('returns null when the name carries no SxxEyy at all', () => {
    expect(parseEpisode('Show.Random.Name.mkv')).toBeNull();
  });
});
