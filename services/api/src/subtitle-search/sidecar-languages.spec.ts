// Sidecar tags are free text from filenames. A tag that resolves to the wrong
// language (or to one that was never present) makes the search skip a language
// that is missing, or fetch one that is already there, with no error anywhere.

import { LanguageRow, resolveSidecarLanguages } from './sidecar-languages';

const LANGS: LanguageRow[] = [
  { tag: 'en', iso2: 'en', iso3: 'eng' },
  { tag: 'es', iso2: 'es', iso3: 'spa' },
  { tag: 'es-419', iso2: 'es', iso3: 'spa' },
  { tag: 'pt', iso2: 'pt', iso3: 'por' },
  { tag: 'fr', iso2: 'fr', iso3: 'fre' },
];

describe('resolveSidecarLanguages', () => {
  it('matches an exact tag, a regional base tag, and a 3-letter code', () => {
    expect(resolveSidecarLanguages(['es'], LANGS)).toEqual(['spa']);
    expect(resolveSidecarLanguages(['es-419'], LANGS)).toEqual(['spa']);
    expect(resolveSidecarLanguages(['pt-BR'], LANGS)).toEqual(['por']);
    expect(resolveSidecarLanguages(['eng'], LANGS)).toEqual(['eng']);
  });

  it('maps a terminology code to its bibliographic iso3', () => {
    expect(resolveSidecarLanguages(['fra'], LANGS)).toEqual(['fre']);
  });

  it('drops language names it cannot resolve', () => {
    expect(resolveSidecarLanguages(['Spanish', 'castellano'], LANGS)).toEqual(
      [],
    );
  });

  it('deduplicates and returns nothing for no tags', () => {
    expect(resolveSidecarLanguages(['es', 'es-419', 'spa'], LANGS)).toEqual([
      'spa',
    ]);
    expect(resolveSidecarLanguages([], LANGS)).toEqual([]);
  });
});
