// Silent failure defended against: an absent or unrecognised libraryLayout that
// throws would fail an encode over a naming convention, and one that resolved to
// the wrong layout would file a correct encode where no scanner will match it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LIBRARY_LAYOUT_VALUES, normalizeLibraryLayout } from './library-layout';

describe('normalizeLibraryLayout', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(LIBRARY_LAYOUT_VALUES)('returns %s unchanged without warning', (layout) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(normalizeLibraryLayout(layout)).toBe(layout);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([undefined, null, '', 'not-a-layout'])('degrades %j to jellyfin and warns', (raw) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(normalizeLibraryLayout(raw)).toBe('jellyfin');
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
