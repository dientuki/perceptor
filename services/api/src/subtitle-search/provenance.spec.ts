import { SubtitleProviderKind } from '@prisma/client';
import { provenanceOf } from './provenance';

// This suite exists because the embedded track's SOURCE tag is written from
// this expression by the driver and later matched against it by the library
// tag migration. If the two ever build the string differently, a migrated
// track silently loses its provider and sync facts and nothing errors.
describe('provenanceOf', () => {
  it('prefers the provider file name verbatim', () => {
    expect(
      provenanceOf({
        providerFileName: 'Movie.2020.es.srt',
        provider: SubtitleProviderKind.SUBDIVX,
        providerSubtitleId: '42',
      }),
    ).toBe('Movie.2020.es.srt');
  });

  it('falls back to the lower-cased provider and the subtitle id', () => {
    expect(
      provenanceOf({
        providerFileName: null,
        provider: SubtitleProviderKind.SUBDIVX,
        providerSubtitleId: '42',
      }),
    ).toBe('subdivx:42');
  });

  it('treats a missing provider as OpenSubtitles', () => {
    expect(
      provenanceOf({
        providerFileName: null,
        provider: null,
        providerSubtitleId: 'a',
      }),
    ).toBe('opensubtitles:a');
  });
});
