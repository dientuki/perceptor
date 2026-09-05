// Article IX: a wrong container tag never crashes anything — ffmpeg accepts
// any string as a -metadata value, the encode still completes, and the file
// plays fine. If buildContainerTitle silently reused sanitize() or
// buildSourceTag silently mishandled the root boundary, the tag would be
// wrong forever with no error in any log.
import { describe, expect, it } from 'vitest';
import { buildContainerTitle, buildSourceTag } from './container-tags';

describe('buildContainerTitle', () => {
  it('returns the film title verbatim, punctuation intact (AC-1)', () => {
    expect(
      buildContainerTitle({
        kind: 'MOVIE',
        title: 'The Martian',
        seasonNumber: null,
        episodeNumber: null,
        episodeTitle: null,
      }),
    ).toBe('The Martian');
  });

  it('pads single-digit season/episode and keeps commas and apostrophes in the episode title (AC-2)', () => {
    expect(
      buildContainerTitle({
        kind: 'EPISODE',
        title: 'The Boys',
        seasonNumber: 5,
        episodeNumber: 7,
        episodeTitle: "The Frenchman, the Female, and the Man Called Mother's Milk",
      }),
    ).toBe("The Boys S05-E07 The Frenchman, the Female, and the Man Called Mother's Milk");
  });

  it('omits the trailing separator when episodeTitle is null (AC-3)', () => {
    expect(
      buildContainerTitle({
        kind: 'EPISODE',
        title: 'The Boys',
        seasonNumber: 5,
        episodeNumber: 7,
        episodeTitle: null,
      }),
    ).toBe('The Boys S05-E07');
  });
});

describe('buildSourceTag', () => {
  it('returns the path relative to downloadsRoot with a nested folder (AC-4)', () => {
    expect(
      buildSourceTag(
        '/downloads',
        '/downloads/Some.Release-GRP/Some.Release-GRP.mkv',
      ),
    ).toBe('Some.Release-GRP/Some.Release-GRP.mkv');
  });

  it('falls back to the base name with no slash when the input lies outside downloadsRoot (AC-5)', () => {
    const result = buildSourceTag('/downloads', '/elsewhere/Some.Release-GRP.mkv');

    expect(result).toBe('Some.Release-GRP.mkv');
    expect(result).not.toContain('/');
  });
});
