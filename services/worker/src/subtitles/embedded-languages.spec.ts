// Defends against asking a provider for a language the file already carries
// (or never carried): a forced track counted as full coverage, an image track
// ignored, or a /T code that never matches the /B code api stores.

import { describe, expect, it } from 'vitest';
import { embeddedLanguages } from './embedded-languages';

const sub = (codec_name: string, language?: string, forced = 0) => ({
  codec_type: 'subtitle',
  codec_name,
  disposition: { forced },
  tags: language === undefined ? {} : { language },
});

describe('embeddedLanguages', () => {
  it('excludes the language of a forced track', () => {
    expect(embeddedLanguages([sub('subrip', 'spa', 1), sub('subrip', 'eng')])).toEqual(['eng']);
  });

  it('counts an image track', () => {
    expect(embeddedLanguages([sub('hdmv_pgs_subtitle', 'spa')])).toEqual(['spa']);
  });

  it('reports fra as fre', () => {
    expect(embeddedLanguages([sub('subrip', 'fra')])).toEqual(['fre']);
  });

  it('drops und, empty and missing tags', () => {
    expect(embeddedLanguages([sub('subrip', 'und'), sub('subrip', ''), sub('subrip')])).toEqual([]);
  });

  it('ignores non-subtitle streams and deduplicates', () => {
    const audio = { codec_type: 'audio', tags: { language: 'jpn' } };
    expect(embeddedLanguages([audio, sub('subrip', 'eng'), sub('ass', 'ENG')])).toEqual(['eng']);
  });
});
