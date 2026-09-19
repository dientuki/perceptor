import type { CalendarEntry } from "@/types/calendar";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function calendarEntryLabel(entry: CalendarEntry): string {
  if (
    entry.kind !== "EPISODES" ||
    entry.seasonNumber === null ||
    entry.firstEpisodeNumber === null
  ) {
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
