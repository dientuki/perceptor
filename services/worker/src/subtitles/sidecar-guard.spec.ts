// Defends against the one irreversible step of the embed: an unlink under the
// library. A sourcePath that escapes the title's folder, names the .mkv itself
// or is not a subtitle must be refused, because the delete reports no error.

import { describe, expect, it } from 'vitest';
import { mayDeleteSidecar } from './sidecar-guard';

const mkv = '/library/movies/Film (2018)/Film (2018).mkv';

describe('mayDeleteSidecar', () => {
  it('accepts a sibling .spa.srt', () => {
    expect(mayDeleteSidecar('/library/movies/Film (2018)/Film (2018).spa.srt', mkv)).toBe(true);
  });

  it('accepts an upper-case extension', () => {
    expect(mayDeleteSidecar('/library/movies/Film (2018)/Film.ENG.SRT', mkv)).toBe(true);
  });

  it('refuses a file in another directory', () => {
    expect(mayDeleteSidecar('/library/movies/Other/Film (2018).spa.srt', mkv)).toBe(false);
    expect(mayDeleteSidecar('/library/movies/Film (2018)/sub/Film.spa.srt', mkv)).toBe(false);
  });

  it('refuses a ../ escape even when the name ends in .srt', () => {
    expect(mayDeleteSidecar('/library/movies/Film (2018)/../Other/x.srt', mkv)).toBe(false);
    expect(mayDeleteSidecar('/library/movies/Film (2018)/../../../etc/x.srt', mkv)).toBe(false);
  });

  it('refuses a name that is not .srt', () => {
    expect(mayDeleteSidecar('/library/movies/Film (2018)/Film.spa.ass', mkv)).toBe(false);
    expect(mayDeleteSidecar('/library/movies/Film (2018)/Film.srt.bak', mkv)).toBe(false);
    expect(mayDeleteSidecar('/library/movies/Film (2018)/poster.jpg', mkv)).toBe(false);
  });

  it('refuses the .mkv itself', () => {
    expect(mayDeleteSidecar(mkv, mkv)).toBe(false);
  });

  it('refuses a relative path and empty input', () => {
    expect(mayDeleteSidecar('Film.spa.srt', mkv)).toBe(false);
    expect(mayDeleteSidecar('', mkv)).toBe(false);
  });
});
