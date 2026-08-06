export const MEDIA_TYPE = {
  MOVIE: "movie",
  SHOW: "show",
} as const;

export type MediaType = (typeof MEDIA_TYPE)[keyof typeof MEDIA_TYPE];

// Placeholder hasta que el api exponga shows/episodes por GraphQL.
// SearchTorrent sólo usa episodeNumber, para armar el "S01E02".
export type Episode = {
  id: string;
  episodeNumber?: number | null;
};
