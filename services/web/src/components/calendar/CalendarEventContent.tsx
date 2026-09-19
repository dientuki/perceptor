import { Clapperboard, Film, Tv } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { StatusTone } from "@/lib/status-tone";
import type { CalendarEntry, CalendarEntryKind } from "@/types/calendar";

const TONE_CLASS: Record<StatusTone, string> = {
  completed: "fc-bg-success",
  progress: "fc-bg-primary",
  error: "fc-bg-danger",
  missing: "",
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function episodeCode(entry: CalendarEntry): string | null {
  if (entry.seasonNumber === null || entry.firstEpisodeNumber === null) {
    return null;
  }
  const count = entry.episodeCount ?? 1;
  const first = `S${pad(entry.seasonNumber)}E${pad(entry.firstEpisodeNumber)}`;
  if (count === 1 || entry.lastEpisodeNumber === null) {
    return first;
  }
  return `${first}–E${pad(entry.lastEpisodeNumber)} · ${entry.completedCount ?? 0}/${count}`;
}

type CalendarEventContentProps = {
  kind: CalendarEntryKind;
  href: string;
  label: string;
  entry: CalendarEntry;
  tone: StatusTone;
};

export default function CalendarEventContent({
  kind,
  href,
  label,
  entry,
  tone,
}: CalendarEventContentProps) {
  const t = useTranslations("calendar");
  const Icon = kind === "MOVIE" ? Film : kind === "SHORT" ? Clapperboard : Tv;
  const kindLabel =
    kind === "MOVIE"
      ? t("kindMovie")
      : kind === "SHORT"
        ? t("kindShort")
        : t("kindEpisodes");

  const isEpisodes = kind === "EPISODES";
  const code = isEpisodes ? episodeCode(entry) : null;

  return (
    <Link
      href={href}
      className={`event-fc-color fc-event-main block min-w-0 ${TONE_CLASS[tone]}`}
      title={`${kindLabel}: ${label}`}
    >
      <span
        className={`fc-event-title ${isEpisodes ? "fc-event-title-single" : ""}`}
      >
        <Icon
          className="fc-event-icon mr-1 inline-block size-3 align-[-1px] text-gray-700"
          aria-label={kindLabel}
        />
        {entry.title}
      </span>
      {code ? <span className="fc-event-count block">{code}</span> : null}
    </Link>
  );
}
