// Defends the path assembly behind REQ-3/REQ-4/REQ-5: this is the join that
// fails silently and totally per 052's plan § Risks. A mismatch here means a
// deselected placeholder is never excluded (the reported bug reproduces), or
// every candidate is wrongly excluded (a good source fails with no video
// found). `null` vs `[]` is the other silent trap: only `null` means "nobody
// knows" — an empty array is a real answer and must flag every file `false`.

import { describe, expect, it } from 'vitest';
import type { ScannedFile } from './scan-folder';
import { markDownloaded } from './mark-downloaded';

function file(overrides: Partial<ScannedFile>): ScannedFile {
  return {
    filePath: '/downloads/release/video.mkv',
    fileName: 'video.mkv',
    size: 1000,
    isVideo: true,
    ...overrides,
  };
}

describe('markDownloaded', () => {
  it('flags every file downloaded, including non-video ones, when the list is null', () => {
    const files = [
      file({ filePath: '/downloads/release/a.mkv', fileName: 'a.mkv' }),
      file({ filePath: '/downloads/release/readme.txt', fileName: 'readme.txt', isVideo: false }),
    ];

    const result = markDownloaded(files, null, '/downloads/release');

    expect(result.every((f) => f.isDownloaded)).toBe(true);
  });

  it('flags only the named video, the other stays false but both are returned', () => {
    const files = [
      file({ filePath: '/downloads/release/A.mkv', fileName: 'A.mkv' }),
      file({ filePath: '/downloads/release/B.mkv', fileName: 'B.mkv' }),
    ];

    const result = markDownloaded(files, ['A.mkv'], '/downloads/release');

    expect(result).toHaveLength(2);
    expect(result.find((f) => f.fileName === 'A.mkv')?.isDownloaded).toBe(true);
    expect(result.find((f) => f.fileName === 'B.mkv')?.isDownloaded).toBe(false);
  });

  it('joins a nested-folder entry against downloadPath and matches the absolute path', () => {
    const files = [file({ filePath: '/downloads/Release.Name/file.mkv', fileName: 'file.mkv' })];

    const result = markDownloaded(files, ['Release.Name/file.mkv'], '/downloads');

    expect(result[0].isDownloaded).toBe(true);
  });

  it('flags every video false when the list matches nothing', () => {
    const files = [
      file({ filePath: '/downloads/release/A.mkv', fileName: 'A.mkv' }),
      file({ filePath: '/downloads/release/B.mkv', fileName: 'B.mkv' }),
    ];

    const result = markDownloaded(files, ['not-in-this-release.mkv'], '/downloads/release');

    expect(result.every((f) => !f.isDownloaded)).toBe(true);
  });

  it('treats an empty array as "nothing downloaded", not as null', () => {
    const files = [file({ filePath: '/downloads/release/A.mkv', fileName: 'A.mkv' })];

    const result = markDownloaded(files, [], '/downloads/release');

    expect(result[0].isDownloaded).toBe(false);
  });
});
