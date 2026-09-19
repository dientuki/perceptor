"use server";

import { redirectIfUnauthenticated } from "@/lib/auth-session";
import { fetchGraphQL } from "@/lib/graphql-client";
import { translateGraphQLError } from "@/lib/graphql-error";
import type { CalendarEntry } from "@/types/calendar";

const CALENDAR_QUERY = `
  query Calendar($from: String!, $to: String!) {
    calendar(from: $from, to: $to) {
      kind
      mediaId
      title
      date
      status
      seasonNumber
      firstEpisodeNumber
      lastEpisodeNumber
      episodeTitle
      episodeCount
      completedCount
    }
  }
`;

export type CalendarEntriesResult =
  | { entries: CalendarEntry[] }
  | { error: string };

export async function getCalendarEntries(
  from: string,
  to: string,
): Promise<CalendarEntriesResult> {
  const { data, errors } = await fetchGraphQL<{
    calendar: CalendarEntry[];
  }>(CALENDAR_QUERY, { from, to });

  if (errors && errors.length > 0) {
    await redirectIfUnauthenticated(errors);
    return { error: await translateGraphQLError(errors[0]) };
  }

  return { entries: data?.calendar ?? [] };
}
