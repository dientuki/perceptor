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
  it('returns the path relative to downloadsRoot when downloadPath is null and the input is inside it (AC-4)', () => {
    expect(
      buildSourceTag(
        '/downloads',
        '/downloads/Some.Release-GRP/Some.Release-GRP.mkv',
        null,
      ),
    ).toBe('Some.Release-GRP/Some.Release-GRP.mkv');
  });

  it('falls back to the base name with no slash when the input lies outside downloadsRoot and downloadPath is null (AC-5)', () => {
    const result = buildSourceTag('/downloads', '/elsewhere/Some.Release-GRP.mkv', null);

    expect(result).toBe('Some.Release-GRP.mkv');
    expect(result).not.toContain('/');
  });

  it('returns the base name, never empty, when downloadPath resolves to the input file itself (REQ-17, uploaded file)', () => {
    const result = buildSourceTag(
      '/downloads',
      '/downloads/imports/abc/Some.Release-GRP.mkv',
      '/downloads/imports/abc/Some.Release-GRP.mkv',
    );

    expect(result).toBe('Some.Release-GRP.mkv');
    expect(result).not.toBe('');
    expect(result).not.toContain('imports/');
  });

  it('treats a non-normalized but equivalent downloadPath as the same loose file (REQ-17)', () => {
    const result = buildSourceTag(
      '/downloads',
      '/downloads/imports/abc/Some.Release-GRP.mkv',
      '/downloads/imports/./abc/Some.Release-GRP.mkv',
    );

    expect(result).toBe('Some.Release-GRP.mkv');
  });

  it('returns the path relative to downloadPath when it is a folder containing the input (torrent, unchanged)', () => {
    expect(
      buildSourceTag(
        '/downloads',
        '/downloads/Some.Release-GRP/Some.Release-GRP.mkv',
        '/downloads/Some.Release-GRP',
      ),
    ).toBe('Some.Release-GRP.mkv');
  });

  it('falls back to the downloadsRoot-relative path when downloadPath does not contain the input', () => {
    expect(
      buildSourceTag(
        '/downloads',
        '/downloads/Some.Release-GRP/Some.Release-GRP.mkv',
        '/downloads/Another.Release-GRP',
      ),
    ).toBe('Some.Release-GRP/Some.Release-GRP.mkv');
  });
});
