---
title: Release Calendar — web slice
service: web
last_updated: 2026-09-19
status: Approved
---

# PLAN: Release Calendar — `web` (`web/plan.md`)

## Scope

`web` turns `/calendar` (an empty route since `033`) into a read-only month view built on FullCalendar,
fed by `Query.calendar` through a new server action. It owns everything visual: the month grid and its
localisation, prev/next/today, entry labels (including REQ-7b's "no count for a group of one" rule),
the kind marker, status colours, the legend, click-through, and the empty/error states. It does **not**
group episodes, derive statuses, compute counts or filter disabled media types — `api` returns entries
already grouped, derived and filtered. It never builds a `Date` from `CalendarEntry.date`.

Writes are confined to `services/web/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `package.json` / `package-lock.json` | Modified | Add `@fullcalendar/core`, `@fullcalendar/react`, `@fullcalendar/daygrid` — nothing else (NFR-5; no `timegrid`, no `interaction`). |
| `src/actions/calendar.ts` | New | `getCalendarEntries(from, to)` server action. |
| `src/types/calendar.ts` | New | `CalendarEntry`, `CalendarEntryKind` — hand copy of the contract. |
| `src/lib/status-tone.ts` | New | `statusTone(status): "completed" \| "progress" \| "error" \| "missing"` — the mapping `StatusBadge` already encodes, lifted out. |
| `src/components/status/StatusBadge.tsx` | Modified | `statusBadgeClass` switches on `statusTone(...)` instead of raw values; rendered output unchanged. |
| `src/components/calendar/Calendar.tsx` | New (replaces the untracked template) | Read-only `dayGridMonth` view; the template's modals, form state, `useModal`, `timeGrid*` views and add-event button are removed outright. |
| `src/components/calendar/CalendarEventContent.tsx` | New | The per-entry render (kind icon + label + tone class), one component per file. |
| `src/components/calendar/CalendarLegend.tsx` | New | Four swatches: completed / in progress / error / not yet. |
| `src/lib/calendar-label.ts` | New | Pure `calendarEntryLabel(entry)` → `Title`, `Show S01E03`, `Show S01E01–E03 · 1/3`. |
| `src/app/(dashboard)/calendar/page.tsx` | Modified | `generateMetadata` + `PageBreadcrumb` + card wrapper + `<Calendar />`, same shape as `shorts/page.tsx`. |
| `messages/en.json`, `messages/es.json` | Modified | `pages.calendar.*` (title, metadata), `calendar.*` (legend, loading, load error, kind labels for `aria`/`title`), `errors.calendar.invalid_date` (`{value}`), `errors.calendar.invalid_range`. |

## Existing code to reuse

- `src/actions/media-server.ts` — the server-action shape to copy. The action is called from a client
  component's event handler, so it may use `redirectIfUnauthenticated` (cookie mutation is legal from a
  Server Action), and it derives error text through `translateGraphQLError` (`src/lib/graphql-error.ts`)
  — never raw `message`.
- `src/components/status/StatusBadge.tsx` — the one status→colour mapping (`COMPLETED` green, `ERROR` red,
  `MISSING` gray, everything else blue). REQ-6 is the same partition; the calendar reads it through the
  extracted `statusTone` so the two can never disagree.
- `src/app/globals.css` — the template's `.fc*`, `.custom-calendar`, `.event-fc-color` and
  `.fc-bg-success` / `.fc-bg-primary` / `.fc-bg-danger` classes already exist. Map `completed` →
  `fc-bg-success`, `progress` → `fc-bg-primary`, `error` → `fc-bg-danger`, `missing` → no bg class.
  Remove the now-dead `.fc-addEventButton-button` and `timegrid` rules only if nothing else uses them.
- `src/app/(dashboard)/shorts/page.tsx` — page shell (metadata via `getTranslations`, breadcrumb, card).
- `useLocale()` from `next-intl` (as in `LanguagePickerField.tsx`) + `@fullcalendar/core/locales/es` for
  FullCalendar's own chrome (month/day names, "today", "+N more"). `SUPPORTED_LOCALES`
  (`src/i18n/locales.ts`) is the list; an unmapped locale falls back to FullCalendar's built-in English.
- `lucide-react` for the kind icons (`Film` / `Clapperboard` / `Tv`, or similar) — no inline SVG.
- `useRouter().push` from `next/navigation` for click-through (`/movies/<mediaId>`, `/shows/<mediaId>`).

## Steps

1. `bin/npm web install @fullcalendar/core @fullcalendar/react @fullcalendar/daygrid`.
2. `src/types/calendar.ts` + `src/actions/calendar.ts` (`CALENDAR_QUERY` with all nine fields). On
   `errors`: `redirectIfUnauthenticated(errors)`, then throw `new Error(translateGraphQLError(errors[0]))`.
3. `src/lib/status-tone.ts`; refactor `StatusBadge` onto it (visual no-op).
4. `src/lib/calendar-label.ts`: `MOVIE`/`SHORT` → `title`; `EPISODES` → `title SxxEyy` when
   `episodeCount === 1`, else `title SxxEaa–Ebb · completed/count`. Zero-pad to two digits.
5. `Calendar.tsx`: `plugins={[dayGridPlugin]}`, `initialView="dayGridMonth"`, `headerToolbar` =
   `prev,next today` / `title` / nothing, `locale` from `useLocale()`, `selectable={false}`,
   `editable={false}`, `eventStartEditable={false}`, `dayMaxEvents` on, `events` as a **function**
   `(info, success, failure)`: `from = info.startStr.slice(0,10)`, `to` = the day before `info.end`
   formatted from local date parts (FullCalendar's `end` is exclusive) → `getCalendarEntries(from, to)` →
   map each entry to `{ id, title: calendarEntryLabel(e), start: e.date, allDay: true, extendedProps: { entry } }`.
   On rejection call `failure` and set an inline error message rendered above the grid (REQ-11); clear
   it on the next successful fetch. `loading` callback drives a small loading indicator.
   `eventClick` → `info.jsEvent.preventDefault()` then `router.push(...)`. No `select`, no `dateClick`.
   No `window.history`/`router` call on month change (REQ-2).
6. `CalendarEventContent.tsx` + `CalendarLegend.tsx`.
7. `calendar/page.tsx`: metadata, breadcrumb, card, `<CalendarLegend />`, `<Calendar />`. No
   `getMediaCapabilities` gate: the route stays reachable with both types off (REQ-9).
8. Catalog keys in both files; `bin/cli web node scripts/check-messages.mjs`.

## Contract obligations

Consumes exactly `../spec.md` § GraphQL Contract Delta — `calendar(from: String!, to: String!)` with all
nine `CalendarEntry` fields; `web` always sends a visible range of at most 42 days, so the 62-day limit
is never hit in normal use. Error handling, each explicitly:

- **Unauthenticated / expired** — `redirectIfUnauthenticated(errors)` in the action (existing session flow).
- **`error.calendar.invalid_date`** (params `{ value }`) — translated via `errors.calendar.invalid_date`,
  shown inline above the grid; navigation keeps working.
- **`error.calendar.invalid_range`** — same, via `errors.calendar.invalid_range`.
- **Anything else** (network, `api` down, no key) — `translateGraphQLError`'s English fallback, or the
  generic `calendar.loadError` string when the action itself rejects without a GraphQL error.
- **`status` outside the eight** — `statusTone` treats it as `missing` (no colour); never throws.
- **Empty list** — empty grid, no message (REQ-11).

The delta is read-only. If it is wrong, stop and report.

## Tests

None — this service has no test runner and must not grow one as a side effect (`services/web/CLAUDE.md`
§ Tests). The logic that can fail silently (grouping, status precedence, counts, range edges, UTC dates)
was deliberately placed in `api`, where it is tested. What remains here — `calendarEntryLabel`, the
`end`-exclusive → inclusive conversion — is covered by the manual pass (AC-3, AC-5b, AC-1 on the last
visible day).

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/npm web run build
bin/cli web node scripts/check-messages.mjs
bin/cli web npx --no biome check src/components/calendar src/actions/calendar.ts src/lib/status-tone.ts src/lib/calendar-label.ts src/components/status/StatusBadge.tsx
```

0 errors, build exits 0, no `en`/`es` drift, Biome clean on the touched files; then the manual pass in
`../plan.md` § Verification.
