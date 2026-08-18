// Defends src/scan/select-matches.ts against the two ways a wrong selection
// files silently: a `single` source encoding the wrong file because a
// bystander sidecar or a stray "SxxEyy" in a name was allowed to compete
// with the largest video, and a `season` source producing two ProcessJobs
// for the same episode because a duplicate/sample file was not collapsed to
// its largest copy. Either failure reaches FFmpeg, encodes, and reports
// success — nothing here is caught anywhere else (Constitution, Article IX).

import { describe, expect, it } from 'vitest';
import { selectMatches } from './select-matches';
import type { ScannedFile } from './scan-folder';

function file(overrides: Partial<ScannedFile>): ScannedFile {
  return {
    filePath: `/downloads/${overrides.fileName}`,
    fileName: 'file.mkv',
    size: 100,
    isVideo: true,
    ...overrides,
  };
}

describe('selectMatches', () => {
  describe('single', () => {
    it('picks the largest video file and ignores non-video sidecars', () => {
      const files: ScannedFile[] = [
        file({ fileName: 'Show.S01E02.nfo', size: 5_000_000, isVideo: false }),
        file({ fileName: 'Show.S01E02.srt', size: 10_000, isVideo: false }),
        file({ fileName: 'Show.S01E02.small.mkv', size: 500, isVideo: true }),
        file({ fileName: 'Show.S01E02.large.mkv', size: 900_000_000, isVideo: true }),
      ];

      const matches = selectMatches(files, { kind: 'single' });

      expect(matches).toEqual([
        { filePath: '/downloads/Show.S01E02.large.mkv', seasonNumber: null, episodeNumber: null },
      ]);
    });

    it('never parses SxxEyy from the name, even for the winning file', () => {
      const files: ScannedFile[] = [file({ fileName: 'Show.S03E07.mkv', size: 1000, isVideo: true })];

      const matches = selectMatches(files, { kind: 'single' });

      expect(matches).toEqual([{ filePath: '/downloads/Show.S03E07.mkv', seasonNumber: null, episodeNumber: null }]);
    });

    it('returns an empty list when there is no video file', () => {
      const files: ScannedFile[] = [file({ fileName: 'readme.txt', size: 10, isVideo: false })];

      expect(selectMatches(files, { kind: 'single' })).toEqual([]);
    });
  });

  describe('season', () => {
    it('returns one entry per parseable episode', () => {
      const files: ScannedFile[] = [
        file({ fileName: 'Show.S02E01.mkv', size: 1000, isVideo: true }),
        file({ fileName: 'Show.S02E02.mkv', size: 1000, isVideo: true }),
        file({ fileName: 'Show.S02E03.mkv', size: 1000, isVideo: true }),
      ];

      const matches = selectMatches(files, { kind: 'season' });

      expect(matches).toHaveLength(3);
      expect(matches).toEqual(
        expect.arrayContaining([
          { filePath: '/downloads/Show.S02E01.mkv', seasonNumber: 2, episodeNumber: 1 },
          { filePath: '/downloads/Show.S02E02.mkv', seasonNumber: 2, episodeNumber: 2 },
          { filePath: '/downloads/Show.S02E03.mkv', seasonNumber: 2, episodeNumber: 3 },
        ]),
      );
    });

    it('keeps only the larger file when two resolve to the same episode', () => {
      const files: ScannedFile[] = [
        file({ fileName: 'Show.S01E01.sample.mkv', size: 5_000, isVideo: true }),
        file({ fileName: 'Show.S01E01.mkv', size: 900_000_000, isVideo: true }),
      ];

      const matches = selectMatches(files, { kind: 'season' });

      expect(matches).toEqual([{ filePath: '/downloads/Show.S01E01.mkv', seasonNumber: 1, episodeNumber: 1 }]);
    });

    it('drops non-video files and files with no parseable SxxEyy', () => {
      const files: ScannedFile[] = [
        file({ fileName: 'Show.S01E01.mkv', size: 1000, isVideo: true }),
        file({ fileName: 'Show.S01E01.nfo', size: 1000, isVideo: false }),
        file({ fileName: 'sample.mkv', size: 1000, isVideo: true }),
      ];

      const matches = selectMatches(files, { kind: 'season' });

      expect(matches).toEqual([{ filePath: '/downloads/Show.S01E01.mkv', seasonNumber: 1, episodeNumber: 1 }]);
    });

    it('returns an empty list when no file in the pack has a parseable name', () => {
      const files: ScannedFile[] = [
        file({ fileName: 'Show.1x02.mkv', size: 1000, isVideo: true }),
        file({ fileName: 'episode 3.mkv', size: 1000, isVideo: true }),
        file({ fileName: 'readme.nfo', size: 10, isVideo: false }),
      ];

      expect(selectMatches(files, { kind: 'season' })).toEqual([]);
    });
  });
});
