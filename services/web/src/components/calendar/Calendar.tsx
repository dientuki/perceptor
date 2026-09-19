"use client";

import type { EventSourceFuncArg } from "@fullcalendar/core";
import esLocale from "@fullcalendar/core/locales/es";
import dayGridPlugin from "@fullcalendar/daygrid";
import FullCalendar from "@fullcalendar/react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
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

export default function Calendar() {
  const t = useTranslations("calendar");
  const locale = useLocale();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const loadEvents = async (
    info: EventSourceFuncArg,
    success: (events: object[]) => void,
    failure: (error: Error) => void,
  ) => {
    try {
      const result = await getCalendarEntries(
        info.startStr.slice(0, 10),
        dayBefore(info.end),
      );
      if ("error" in result) {
        setError(result.error);
        failure(new Error(result.error));
        return;
      }
      setError(null);
      success(
        result.entries.map((entry, index) => ({
          id: `${entry.kind}-${entry.mediaId}-${entry.date}-${index}`,
          title: calendarEntryLabel(entry),
          start: entry.date,
          allDay: true,
          extendedProps: { entry },
        })),
      );
    } catch {
      setError(t("loadError"));
      failure(new Error(t("loadError")));
    }
  };

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
          plugins={[dayGridPlugin]}
          initialView="dayGridMonth"
          headerToolbar={{
            left: "prev,next today",
            center: "title",
            right: "",
          }}
          locales={[esLocale]}
          locale={locale}
          selectable={false}
          editable={false}
          eventStartEditable={false}
          dayMaxEvents={4}
          height="auto"
          handleWindowResize
          events={loadEvents}
          loading={setIsLoading}
          eventContent={(arg) => {
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
          }}
        />
      </div>
    </div>
  );
}
