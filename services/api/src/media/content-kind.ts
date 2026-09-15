/**
 * Content kind classification (REQ-2..REQ-5): genre-then-keywords, derived once at registration.
 * A plain, dependency-free module by design — no Nest, no Prisma client, no injection, following
 * `src/pipeline-status/pipeline-status.ts`'s precedent for a rule as a plain exported function.
 */
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

/**
 * REQ-2: not animated (genre 16 absent) -> LIVE_ACTION, no keyword lookup needed.
 * REQ-4: animated and `3d-animation` present -> CGI. Checked first — precedence matters.
 * REQ-3: animated and (`anime` or `cartoon`) present -> ANIME.
 * REQ-5: animated with no usable/matching keyword (empty, undefined, or none of the three known
 * ids) -> CGI, the fallback default for animated content with an undecided style.
 */
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
