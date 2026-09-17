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
      // The parent series' language preference (`039-per-title-language-split`) —
      // an episode has none of its own, so the ranking heuristic (`036`, REQ-25)
      // reads the series' flag through this branch instead.
      audioMandatory: boolean;
      audioLanguages: Language[];
    }
  | {
      kind: "season";
      season: Season;
      showTitle: string;
      // Same parent-series fallback as the episode branch above — a season has
      // no audio preference of its own either (059-season-pack-acquisition-ui).
      audioMandatory: boolean;
      audioLanguages: Language[];
    };

// The subset of `AcquisitionTarget` that can reach a file upload. A season
// target has no upload entry point (REQ-2, 059-season-pack-acquisition-ui) —
// `createUploadTicketAction`/`importFileModal.tsx` take this instead of the
// full union so a season can never reach `movieId: undefined, episodeId:
// undefined` by accident; the exclusion is enforced by the type checker, not
// by a runtime guard.
export type FileAcquisitionTarget = Exclude<
  AcquisitionTarget,
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
