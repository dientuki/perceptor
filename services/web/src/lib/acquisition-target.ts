import type { AcquisitionTarget } from "@/types/media";

/**
 * Whether the acquiring this target would replace an already-delivered file —
 * the condition every acquisition modal (search, magnet, upload) shows its
 * "replace warning" on. A film or an episode is completed on its own status;
 * a season is completed when any of its episodes is (059-season-pack-
 * acquisition-ui), matching `error.season.already_completed`'s condition.
 */
export function isAcquisitionTargetCompleted(
  target: AcquisitionTarget,
): boolean {
  switch (target.kind) {
    case "movie":
      return target.movie.status === "COMPLETED";
    case "episode":
      return target.episode.status === "COMPLETED";
    case "season":
      return target.season.episodes.some(
        (episode) => episode.status === "COMPLETED",
      );
  }
}

/**
 * The human-readable name of an acquisition target, shown in every modal's
 * description and replace warning. `src/lib` cannot call hooks, so the
 * season label ("Temporada N") is built by the caller and passed in rather
 * than resolved here through `useTranslations`.
 */
export function buildAcquisitionTargetLabel(
  target: AcquisitionTarget,
  formatSeasonLabel: (seasonNumber: number) => string,
): string {
  switch (target.kind) {
    case "movie":
      return target.movie.title;
    case "episode":
      return `${target.showTitle} S${String(target.seasonNumber).padStart(2, "0")}E${String(target.episode.episodeNumber).padStart(2, "0")}`;
    case "season":
      return `${target.showTitle} ${formatSeasonLabel(target.season.seasonNumber)}`;
  }
}
