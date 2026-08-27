import type { Movie } from "@/actions/movies";
import type { Episode } from "@/actions/shows";

export const MEDIA_TYPE = {
  MOVIE: "movie",
  SHOW: "show",
} as const;

export type MediaType = (typeof MEDIA_TYPE)[keyof typeof MEDIA_TYPE];

// Discriminated union so a target is either a movie or an episode, never
// both — an episode paired with MEDIA_TYPE.MOVIE was exactly how an episode
// id used to reach a movieId argument with no compile error.
export type AcquisitionTarget =
  | { kind: "movie"; movie: Movie }
  | {
      kind: "episode";
      episode: Episode;
      showTitle: string;
      seasonNumber: number;
    };

// The discriminated return of every acquisition Server Action (magnet,
// torrent, upload ticket). A `throw` loses `extensions.i18n.key` at the
// Server Action boundary — the message survives, the key does not — which is
// why a refusal (including the expected "already completed" one) arrives as
// data instead. Matches the `{ error?: string } | { success: true }` shape
// services/web/CLAUDE.md documents for write actions.
export type AcquisitionResult =
  | { success: true; id: number; status: string }
  | { error: string; errorKey?: string };
