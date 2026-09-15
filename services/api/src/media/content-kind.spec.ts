/**
 * `classifyContentKind` is the only place the genre-then-keywords rule lives. A wrong precedence
 * here (e.g. checking `anime`/`cartoon` before `3d-animation`) produces a perfectly valid
 * `ContentKind` value and a wrongly-tuned FFmpeg encode nobody notices until they watch the file —
 * there is no exception, no failed test elsewhere, nothing. These cases exist because otherwise a
 * misclassified title fails with no error anywhere.
 */
import { classifyContentKind } from './content-kind';
import { ContentKind } from './entities/content-kind.enum';

describe('classifyContentKind', () => {
  it('classifies a title with no animation genre as LIVE_ACTION, ignoring any keywords', () => {
    expect(
      classifyContentKind({
        genreIds: [18], // Drama, no 16
        keywordIds: [210024, 6513], // would say ANIME if animated, but genre says it is not
      }),
    ).toBe(ContentKind.LIVE_ACTION);
  });

  it('classifies an animated title with only the 3d-animation keyword as CGI', () => {
    expect(
      classifyContentKind({
        genreIds: [16],
        keywordIds: [278823],
      }),
    ).toBe(ContentKind.CGI);
  });

  it('classifies an animated title with only the anime keyword as ANIME', () => {
    expect(
      classifyContentKind({
        genreIds: [16],
        keywordIds: [210024],
      }),
    ).toBe(ContentKind.ANIME);
  });

  it('classifies an animated title with only the cartoon keyword as ANIME', () => {
    expect(
      classifyContentKind({
        genreIds: [16],
        keywordIds: [6513],
      }),
    ).toBe(ContentKind.ANIME);
  });

  // REQ-4's precedence — the case the author reversed once. 3d-animation must win even when
  // anime/cartoon are also present, and the check must run first.
  it('classifies an animated title with both anime and 3d-animation keywords as CGI, not ANIME', () => {
    expect(
      classifyContentKind({
        genreIds: [16],
        keywordIds: [210024, 278823],
      }),
    ).toBe(ContentKind.CGI);
  });

  it('classifies an animated title with an empty keyword list as CGI', () => {
    expect(
      classifyContentKind({
        genreIds: [16],
        keywordIds: [],
      }),
    ).toBe(ContentKind.CGI);
  });

  it('classifies an animated title with undefined keywords as CGI', () => {
    expect(
      classifyContentKind({
        genreIds: [16],
        keywordIds: undefined,
      }),
    ).toBe(ContentKind.CGI);
  });
});
