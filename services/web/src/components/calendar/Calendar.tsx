"use client";

import FullCalendar, {
  type DatesSetInfo,
  type EventDisplayInfo,
  type EventInput,
} from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import esLocale from "@fullcalendar/react/locales/es";
import themePlugin from "@fullcalendar/react/themes/classic";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useRef, useState } from "react";
import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/classic/theme.css";
import "@fullcalendar/react/themes/classic/palette.css";
import { getCalendarEntries } from "@/actions/calendar";
import CalendarEventContent from "@/components/calendar/CalendarEventContent";
import { calendarEntryLabel } from "@/lib/calendar-label";
import { statusTone } from "@/lib/status-tone";
import type { CalendarEntry } from "@/types/calendar";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function dayBefore(end: Date): string {
  const day = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1);
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

const HEADER_TOOLBAR = {
  left: "prev,next today",
  center: "title",
  right: "",
};

const LOCALES = [esLocale];

export default function Calendar() {
  const t = useTranslations("calendar");
  const locale = useLocale();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [events, setEvents] = useState<EventInput[]>([]);
  const latestRequest = useRef(0);

  const loadEvents = useCallback(
    async (info: DatesSetInfo) => {
      const request = ++latestRequest.current;
      setIsLoading(true);
      try {
        const result = await getCalendarEntries(
          info.startStr.slice(0, 10),
          dayBefore(info.end),
        );
        if (request !== latestRequest.current) {
          return;
        }
        if ("error" in result) {
          setError(result.error);
          return;
        }
        setError(null);
        setEvents(
          result.entries.map((entry, index) => ({
            id: `${entry.kind}-${entry.mediaId}-${entry.date}-${index}`,
            title: calendarEntryLabel(entry, t),
            start: entry.date,
            allDay: true,
            extendedProps: { entry },
          })),
        );
      } catch {
        if (request === latestRequest.current) {
          setError(t("loadError"));
        }
      } finally {
        if (request === latestRequest.current) {
          setIsLoading(false);
        }
      }
    },
    [t],
  );

  const renderEventContent = useCallback((arg: EventDisplayInfo) => {
    const entry = arg.event.extendedProps.entry as CalendarEntry;
    return (
      <CalendarEventContent
        kind={entry.kind}
        href={
          entry.kind === "EPISODES"
            ? `/shows/${entry.mediaId}`
            : `/movies/${entry.mediaId}`
        }
        label={arg.event.title}
        entry={entry}
        tone={statusTone(entry.status)}
      />
    );
  }, []);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
      {error ? (
        <p
          role="alert"
          className="m-4 rounded-lg border border-error-200 bg-error-50 px-4 py-3 text-error-600 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-400"
        >
          {error}
        </p>
      ) : null}
      {isLoading ? (
        <p className="px-4 pt-4 text-gray-500 dark:text-gray-400">
          {t("loading")}
        </p>
      ) : null}
      <div className="custom-calendar">
        <FullCalendar
          plugins={[themePlugin, dayGridPlugin]}
          initialView="dayGridMonth"
          headerToolbar={HEADER_TOOLBAR}
          locales={LOCALES}
          locale={locale}
          selectable={false}
          editable={false}
          dayMaxEvents={4}
          height="auto"
          eventClass="calendar-event"
          events={events}
          datesSet={loadEvents}
          eventContent={renderEventContent}
        />
      </div>
    </div>
  );
}
