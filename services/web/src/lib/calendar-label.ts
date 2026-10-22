import type { CalendarEntry, MovieReleaseType } from "@/types/calendar";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

const RELEASE_TYPE_KEY = {
  THEATRICAL: "releaseTheatrical",
  DIGITAL: "releaseDigital",
  PHYSICAL: "releasePhysical",
} as const;

type ReleaseTypeKey = (typeof RELEASE_TYPE_KEY)[MovieReleaseType];

export function releaseTypePrefix(
  types: readonly string[] | null,
  translate: (key: ReleaseTypeKey) => string,
): string {
  if (!types) return "";
  return types
    .filter((type): type is MovieReleaseType =>
      Object.hasOwn(RELEASE_TYPE_KEY, type),
    )
    .map((type) => `${translate(RELEASE_TYPE_KEY[type])} `)
    .join("");
}

export function calendarEntryLabel(
  entry: CalendarEntry,
  translate: (key: ReleaseTypeKey) => string,
): string {
  if (entry.kind !== "EPISODES") {
    return `${releaseTypePrefix(entry.releaseTypes, translate)}${entry.title}`;
  }
  if (entry.seasonNumber === null || entry.firstEpisodeNumber === null) {
    return entry.title;
  }

  const season = `S${pad(entry.seasonNumber)}`;
  const first = `E${pad(entry.firstEpisodeNumber)}`;
  const count = entry.episodeCount ?? 1;

  if (count === 1 || entry.lastEpisodeNumber === null) {
    return `${entry.title} ${season}${first}`;
  }

  const last = `E${pad(entry.lastEpisodeNumber)}`;
  const completed = entry.completedCount ?? 0;
  return `${entry.title} ${season}${first}–${last} · ${completed}/${count}`;
}
