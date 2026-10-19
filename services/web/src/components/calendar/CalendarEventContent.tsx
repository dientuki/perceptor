import { Clapperboard, Film, Tv } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { releaseTypePrefix } from "@/lib/calendar-label";
import type { StatusTone } from "@/lib/status-tone";
import type { CalendarEntry, CalendarEntryKind } from "@/types/calendar";

const TONE_CLASS: Record<StatusTone, string> = {
  completed: "border-success-500 bg-success-50 dark:bg-success-500/15",
  progress: "border-brand-500 bg-brand-50 dark:bg-brand-500/15",
  error: "border-error-500 bg-error-50 dark:bg-error-500/15",
  missing: "border-gray-300 dark:border-gray-700",
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
      className={`block w-full min-w-0 rounded-lg border px-1 py-0.5 text-gray-700 dark:text-white/90 ${TONE_CLASS[tone]}`}
      title={`${kindLabel}: ${label}`}
    >
      <span
        className={`min-w-0 overflow-hidden text-base font-normal ${
          isEpisodes ? "block truncate" : "line-clamp-2"
        }`}
      >
        <Icon
          className="mr-1 inline-block size-3 align-[-1px] text-gray-700"
          aria-label={kindLabel}
        />
        {releaseTypePrefix(entry.releaseTypes, t)}
        {entry.title}
      </span>
      {code ? (
        <span className="block truncate text-theme-sm text-gray-500 dark:text-gray-400">
          {code}
        </span>
      ) : null}
    </Link>
  );
}
