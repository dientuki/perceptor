// Spec 057, REQ-2 REQ-3 REQ-4 REQ-5
import { ContentKind } from './entities/content-kind.enum';

/** TMDB genre id for "Animation". */
const ANIMATION_GENRE_ID = 16;

/** TMDB keyword ids that disambiguate an animated title's style. */
const KEYWORD_3D_ANIMATION = 278823;
const KEYWORD_ANIME = 210024;
const KEYWORD_CARTOON = 6513;

export type ClassifyContentKindInput = {
  genreIds: number[] | undefined;
  keywordIds: number[] | undefined;
};

// Spec 057, REQ-2 REQ-3 REQ-4 REQ-5
export function classifyContentKind({ genreIds, keywordIds }: ClassifyContentKindInput): ContentKind {
  const isAnimated = (genreIds ?? []).includes(ANIMATION_GENRE_ID);
  if (!isAnimated) {
    return ContentKind.LIVE_ACTION;
  }

  const keywords = keywordIds ?? [];

  if (keywords.includes(KEYWORD_3D_ANIMATION)) {
    return ContentKind.CGI;
  }

  if (keywords.includes(KEYWORD_ANIME) || keywords.includes(KEYWORD_CARTOON)) {
    return ContentKind.ANIME;
  }

  return ContentKind.CGI;
}
