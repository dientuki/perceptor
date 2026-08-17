// Defends REQ-12: cleanup-source.ts must never delete anything outside
// `downloadsRoot`. A containment check that treats a shared-prefix sibling
// ("/media/downloads-old" vs "/media/downloads") as "inside", or that reads
// a missing/relative root as "everything passes", would let the worker
// delete arbitrary paths with no error in any log — the exact failure mode
// this suite exists to catch.

import { describe, expect, it } from 'vitest';
import { isInsideRoot } from './is-inside-root';

describe('isInsideRoot', () => {
  it('accepts the root itself', () => {
    expect(isInsideRoot('/media/downloads', '/media/downloads')).toBe(true);
  });

  it('accepts a nested path', () => {
    expect(isInsideRoot('/media/downloads', '/media/downloads/abcd1234')).toBe(true);
  });

  it('accepts a deeply nested path', () => {
    expect(isInsideRoot('/media/downloads', '/media/downloads/imports/upload-1/movie.mkv')).toBe(true);
  });

  it('refuses a shared-prefix sibling directory', () => {
    // "/media/downloads-old" starts with the string "/media/downloads" but
    // is not inside it — a naive startsWith(root) check (no separator)
    // would wrongly accept this.
    expect(isInsideRoot('/media/downloads', '/media/downloads-old/movie.mkv')).toBe(false);
  });

  it('refuses a parent directory of the root', () => {
    expect(isInsideRoot('/media/downloads', '/media')).toBe(false);
  });

  it('refuses a sibling directory entirely', () => {
    expect(isInsideRoot('/media/downloads', '/media/library/movie.mkv')).toBe(false);
  });

  it('refuses a "../" traversal that lands outside the root', () => {
    expect(isInsideRoot('/media/downloads', '/media/downloads/../library/movie.mkv')).toBe(false);
  });

  it('accepts a "../" traversal that still lands inside the root', () => {
    expect(isInsideRoot('/media/downloads', '/media/downloads/a/../b/movie.mkv')).toBe(true);
  });

  it('refuses an empty root', () => {
    expect(isInsideRoot('', '/media/downloads/abcd1234')).toBe(false);
  });

  it('refuses a relative root', () => {
    expect(isInsideRoot('downloads', '/media/downloads/abcd1234')).toBe(false);
  });

  it('refuses an empty candidate', () => {
    expect(isInsideRoot('/media/downloads', '')).toBe(false);
  });
});
