// The provider code list decides which language is searched. Portuguese and
// Chinese have two provider variants; searching only one silently misses the
// other's subtitles.

import { providerLanguageCodes } from './provider-languages';

const LANGS = [
  { tag: 'es', iso2: 'es', iso3: 'spa' },
  { tag: 'es-419', iso2: 'es', iso3: 'spa' },
  { tag: 'pt', iso2: 'pt', iso3: 'por' },
  { tag: 'zh', iso2: 'zh', iso3: 'chi' },
];

describe('providerLanguageCodes', () => {
  it('expands Portuguese and Chinese to both variants', () => {
    expect(providerLanguageCodes('por', LANGS)).toEqual(['pt-pt', 'pt-br']);
    expect(providerLanguageCodes('chi', LANGS)).toEqual(['zh-cn', 'zh-tw']);
  });

  it('maps iso3 to the base tag, never a regional one', () => {
    expect(providerLanguageCodes('spa', LANGS)).toEqual(['es']);
  });

  it('returns nothing for an unknown language', () => {
    expect(providerLanguageCodes('xxx', LANGS)).toEqual([]);
  });
});
