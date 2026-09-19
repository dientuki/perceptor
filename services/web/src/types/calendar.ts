export type CalendarEntryKind = "MOVIE" | "SHORT" | "EPISODES";

export type CalendarEntry = {
  kind: CalendarEntryKind;
  mediaId: number;
  title: string;
  date: string;
  status: string;
  seasonNumber: number | null;
  firstEpisodeNumber: number | null;
  lastEpisodeNumber: number | null;
  episodeTitle: string | null;
  episodeCount: number | null;
  completedCount: number | null;
};
