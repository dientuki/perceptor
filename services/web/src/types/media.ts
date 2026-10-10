import type { Movie } from "@/actions/movies";
import type { Episode, Season } from "@/actions/shows";
import type { Language } from "@/types/languages";

export const MEDIA_TYPE = {
  MOVIE: "movie",
  SHOW: "show",
} as const;

export type MediaType = (typeof MEDIA_TYPE)[keyof typeof MEDIA_TYPE];

// Order here is the single source of `<select>` option order and must stay in
// sync with `api`'s `ContentKind` enum declaration order.
export type ContentKind = "LIVE_ACTION" | "ANIME" | "CGI";

export const CONTENT_KINDS: readonly ContentKind[] = [
  "LIVE_ACTION",
  "ANIME",
  "CGI",
] as const;

// System-wide capability flags — identical for every user, read from the
// `movies_enabled` / `shows_enabled` Settings rows (045-media-type-availability).
export interface MediaCapabilities {
  moviesEnabled: boolean;
  showsEnabled: boolean;
  shortsEnabled: boolean;
  // movie_db_api_key is non-empty (071-tmdb-key-onboarding); never the key itself.
  catalogKeyConfigured: boolean;
}

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
      // Spec 036, REQ-25
      audioMandatory: boolean;
      audioLanguages: Language[];
    }
  | {
      kind: "season";
      season: Season;
      showTitle: string;
      // Spec 036, REQ-25
      audioMandatory: boolean;
      audioLanguages: Language[];
    };

// Spec 068, REQ-1; Spec 059, REQ-2
export type FileAcquisitionTarget = AcquisitionTarget;

export type SingleFileAcquisitionTarget = Exclude<
  FileAcquisitionTarget,
  { kind: "season" }
>;

// The discriminated return of every acquisition Server Action (magnet,
// torrent, upload ticket). A `throw` loses `extensions.i18n.key` at the
// Server Action boundary — the message survives, the key does not — which is
// why a refusal (including the expected "already completed" one) arrives as
// data instead. Matches the `{ error?: string } | { success: true }` shape
// services/web/CLAUDE.md documents for write actions. Narrowed to carry no
// payload (059-season-pack-acquisition-ui): `addTorrentToSeason`/
// `addMagnetToSeason` return a `Season`, which has no `status`, and nothing
// reads `id`/`status` off a success today — every caller refreshes the page
// instead of patching state from the response.
export type AcquisitionResult =
  | { success: true }
  | { error: string; errorKey?: string };

/** Outcome of refreshMovie/refreshShow. FAILED outcomes are reported, not thrown. */
export type TitleRefreshResult =
  | {
      success: true;
      catalog: "DONE" | "FAILED";
      mediaServer: "DONE" | "SKIPPED" | "FAILED";
      promoted: number;
      demoted: number;
    }
  | { error: string };

/** Outcome of removeMovie/removeShow; `deleted` is false when only the caller's reference went. */
export type TitleRemovalResult =
  | { success: true; deleted: boolean; remainingOwners: number }
  | { error: string };
