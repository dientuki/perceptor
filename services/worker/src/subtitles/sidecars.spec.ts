// Defends against crediting a film with another file's subtitles: a sibling
// "<base> - 4K" sharing the prefix, or a forced sidecar counted as full coverage.

import { describe, expect, it } from 'vitest';
import { sidecarLanguageTags } from './sidecars';

const base = 'Movie (2020)';

describe('sidecarLanguageTags', () => {
  it('reads the tag of <base>.es.srt', () => {
    expect(sidecarLanguageTags([`${base}.es.srt`], base)).toEqual(['es']);
  });

  it('drops a forced sidecar', () => {
    expect(sidecarLanguageTags([`${base}.es-419.forced.srt`], base)).toEqual([]);
  });

  it('drops a foreign sidecar', () => {
    expect(sidecarLanguageTags([`${base}.en.Foreign.srt`], base)).toEqual([]);
  });

  it('reports the tag raw and ignores sdh', () => {
    expect(sidecarLanguageTags([`${base}.Spanish.sdh.srt`], base)).toEqual(['Spanish']);
  });

  it('does not take a sidecar of a sibling sharing the prefix', () => {
    expect(sidecarLanguageTags([`${base} - 4K.es.srt`], base)).toEqual([]);
  });

  it('drops a sidecar with no tag', () => {
    expect(sidecarLanguageTags([`${base}.srt`], base)).toEqual([]);
  });

  it('ignores non-subtitle files and deduplicates', () => {
    expect(
      sidecarLanguageTags([`${base}.mkv`, `${base}.es.srt`, `${base}.es.ass`, `${base}.nfo`], base),
    ).toEqual(['es']);
  });
});
