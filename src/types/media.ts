export const MEDIA_TYPE = {
  MOVIE: "movie",
  TV: "tv",
} as const;

export type MediaType = (typeof MEDIA_TYPE)[keyof typeof MEDIA_TYPE];
