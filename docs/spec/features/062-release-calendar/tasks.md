---
title: Release Calendar — Tasks
last_updated: 2026-09-19
status: Draft
---

# TASKS: Release Calendar (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` | Which subagent owns the task. Exactly one per task. |
| `[docs]` | Documentation and the cross-service verification sweep. Owned by the orchestrator. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

`worker` is not in this feature. Its diff must stay empty; no task touches `services/worker/`. No
Prisma migration: `git status --short services/api/prisma` must stay empty throughout.

## Tasks

### Group 1 — shared derivation, range and grouping (`api`, pure functions)

- [ ] **T001** `[api] [P]` In `src/pipeline-status/pipeline-status.ts`, add a pure exported
      `deriveEpisodeStatus(seasonSources, episode, now)` holding exactly the per-episode body of
      `ShowsService.deriveSeasonEpisodeStatuses` (the `isLiftedBySeasonPack` check feeding
      `deriveTitleStatus` an extra `{ status: 'QUEUED' }` source). Make
      `deriveSeasonEpisodeStatuses` call it, one `now` per call, behaviour unchanged. In
      `pipeline-status.spec.ts`, a new `describe` with its Article IX header: lifted aired episode →
      `QUEUED`; unaired → `MISSING`; stored `ERROR` wins over a lift; `SCANNED`/`ERROR` season source
      lifts nothing. See `api/plan.md` step 1.
      *Done when:* `bin/npm api test` passes with the new cases counted and
      `src/shows/shows.service.spec.ts` passes **unmodified** (`git diff --stat` on it is empty).
- [ ] **T002** `[api] [P]` Add `CALENDAR_INVALID_DATE: 'error.calendar.invalid_date'` and
      `CALENDAR_INVALID_RANGE: 'error.calendar.invalid_range'` to `src/i18n/error-keys.ts`, with
      templates `Invalid date: {value}` / `Invalid calendar range` in `src/i18n/messages.en.ts`. Add
      `src/calendar/calendar-range.ts`: pure `parseCalendarRange(from, to)` → `{ from, toExclusive }`
      (UTC midnight; `toExclusive = to + 1 day`), throwing `i18nError.badRequest` with
      `invalid_date` + `{ value }` for anything not `YYYY-MM-DD` or not round-tripping through a UTC
      `Date` (`2026-02-30`, `2026-13-01`), and `invalid_range` for `to < from` or an inclusive span
      over 62 days. `src/calendar/calendar-range.spec.ts` with its Article IX header: same-day range,
      62-day accepted, 63 refused, reversed refused, both impossible dates refused naming the bad
      value, `toExclusive` exactly one day past `to`. See `api/plan.md` steps 2–3.
      *Done when:* `bin/npm api test` passes including `messages.en.spec.ts` and the new file.
- [ ] **T003** `[api] [P]` Add `src/calendar/group-episodes.ts`: pure grouping of derived episode rows
      by `(showId, seasonNumber, UTC day)` into entries with `firstEpisodeNumber`/`lastEpisodeNumber`
      (min/max), `episodeCount`, `completedCount`, `episodeTitle` (only when the group has one
      member), and group status per REQ-7 (any `ERROR` → `ERROR`; else the most advanced in-progress
      value present; else all `COMPLETED` → `COMPLETED`; else `MISSING`).
      `src/calendar/group-episodes.spec.ts` with its Article IX header: each REQ-7 branch, one
      `ERROR` among `COMPLETED` → `ERROR`, `COMPLETED`+`MISSING` → `MISSING` with `completedCount`
      correct, the *Reacher* case (E01–E03 same day + E04/E05 weekly → one group of 3 plus two
      singles), two seasons on one day → two groups. See `api/plan.md` step 6.
      *Done when:* `bin/npm api test` passes with the new file counted, and swapping the `ERROR` and
      in-progress precedence makes at least one case fail (fault injection, reverted).

### Group 2 — ranged reads and the query (`api`)

- [ ] **T004** `[api]` Add `MoviesService.findReleasedBetween(userId, from, toExclusive)`
      (`releaseDate: { gte, lt }`, `users: { some: { userId } }`, include `mediaSources`/`processJobs`,
      mapped through `withDerivedStatus`) and `ShowsService.findEpisodesReleasedBetween(userId, from,
      toExclusive)` (episodes in range of shows the user owns, with show id/title, season number, season
      `mediaSources` filtered `status: { not: 'ERROR' }` as in `findOneFromDb`, episode
      `mediaSources`/`processJobs`; status via T001's `deriveEpisodeStatus`, one `now`). One case each
      in `movies.service.spec.ts`/`shows.service.spec.ts` asserting the ownership clause and the date
      bounds reach Prisma. See `api/plan.md` steps 4–5. → T001
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors; `bin/npm api test` passes
      with both cases counted.
- [ ] **T005** `[api]` Add `src/calendar/` — `entities/calendar-entry-kind.enum.ts`
      (`registerEnumType`, same shape as `src/media/entities/content-kind.enum.ts`),
      `entities/calendar-entry.entity.ts`, `calendar.service.ts` (parse range; one
      `MediaCapabilitiesService.read()`; films only if `moviesEnabled`, `isShort` films only if
      `shortsEnabled`; episodes only if `showsEnabled`; `MOVIE`/`SHORT`/`EPISODES`; `date` as UTC
      `YYYY-MM-DD`; order by `date`, `title`, `seasonNumber`, `firstEpisodeNumber`),
      `calendar.resolver.ts` (`calendar(from: String!, to: String!)`, userId via
      `principal.type === 'user' ? principal.id : ''`), `calendar.module.ts`; register in
      `app.module.ts`. `calendar.service.spec.ts` with its Article IX header: each capability combination,
      `SHORT` from `isShort`, a `2026-09-19T00:00:00Z` release reads `date: "2026-09-19"`, ordering,
      range errors propagate. See `api/plan.md` steps 7–8. → T002, T003, T004
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors; `bin/npm api test` passes
      above 559/46; after the dev server regenerates it, `git diff services/api/src/schema.gql` shows
      exactly `enum CalendarEntryKind`, `type CalendarEntry` (nine fields, nullability as in
      `spec.md`) and `calendar(from: String!, to: String!): [CalendarEntry!]!`;
      `git status --short services/api/prisma` is empty; a live query for the current month as a
      signed-in user returns the expected entries and `calendar(from:"2026-09-01", to:"2026-12-31")`
      returns `extensions.i18n.key = "error.calendar.invalid_range"`.

### Group 3 — the page (`web`)

T006–T008 need nothing from `api` and may start immediately; T009 consumes the contract and waits
for T005.

- [ ] **T006** `[web] [P]` `bin/npm web install @fullcalendar/core @fullcalendar/react
      @fullcalendar/daygrid` — no other package. See `web/plan.md` step 1.
      *Done when:* `package.json` lists exactly those three new dependencies and
      `bin/npm web run build` exits 0.
- [ ] **T007** `[web] [P]` Add `src/lib/status-tone.ts` (`statusTone(status)` →
      `"completed" | "progress" | "error" | "missing"`, unknown values → `"missing"`) and move
      `StatusBadge.tsx`'s colour switch onto it with no visual change. Add `src/lib/calendar-label.ts`
      (`calendarEntryLabel(entry)`: `Title`; `Show S01E03`; `Show S01E01–E03 · 1/3`, two-digit
      padding, no count when `episodeCount === 1`) and `src/types/calendar.ts` (hand copy of the
      contract). See `web/plan.md` steps 3–4.
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports 0 errors; the downloads panel and a
      show's season accordion render the same badge colours as before.
- [ ] **T008** `[web] [P]` Add catalog keys to both `messages/en.json` and `messages/es.json`:
      `pages.calendar.{title,metadataTitle,metadataDescription}`, `calendar.*` (four legend labels,
      loading, generic load error, kind labels), `errors.calendar.invalid_date` (with `{value}`),
      `errors.calendar.invalid_range`. `es` in the existing Rioplatense register.
      *Done when:* `bin/cli web node scripts/check-messages.mjs` reports no drift.
- [ ] **T009** `[web]` Add `src/actions/calendar.ts` (`getCalendarEntries(from, to)`, shape of
      `src/actions/media-server.ts`, all nine fields, `redirectIfUnauthenticated` then
      `translateGraphQLError` on errors). Replace the untracked template
      `src/components/calendar/Calendar.tsx` with a read-only `dayGridMonth` view (no modals, no
      `useModal`, no `timeGrid`, no `interaction` plugin, no add button; `prev,next today` / `title`;
      `locale` from `useLocale()` with `@fullcalendar/core/locales/es`; function-valued `events` with
      `to` = the day before FullCalendar's exclusive `end`; entries as all-day `start: entry.date`;
      inline error above the grid on failure, cleared on the next success; loading indicator;
      `eventClick` → `router.push` to `/movies/<mediaId>` or `/shows/<mediaId>`; no URL change on
      month change). Add `CalendarEventContent.tsx` (lucide kind icon + label + tone →
      `fc-bg-success`/`fc-bg-primary`/`fc-bg-danger`/none) and `CalendarLegend.tsx`. Rewrite
      `src/app/(dashboard)/calendar/page.tsx` on the `shorts/page.tsx` shell, with no capability gate.
      See `web/plan.md` steps 2, 5–7. → T005, T006, T007, T008
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports 0 errors; `bin/npm web run build` exits
      0; `bin/cli web npx --no biome check` on the touched calendar/actions/lib/StatusBadge files is
      clean; opening `/calendar` on a running stack shows the current month with registered titles,
      next/prev/today change the entries while the address bar stays exactly `/calendar`, and
      clicking an entry opens its detail page.

### Group 4 — verification and docs

- [ ] **T010** `[docs]` Append a `062` section to `docs/spec/graphql-contract.md`: the query, the
      entry type, why `date`/`from`/`to` are `String` calendar days, that disabled types are filtered
      rather than refused, and the two error keys. → T005
      *Done when:* the section exists and its SDL matches the regenerated `schema.gql`.
- [ ] **T011** `[docs]` Update the root `CLAUDE.md` "Browse library" row (`062` added, `/calendar`
      described) and "Current state" with the measured counts; `services/api/CLAUDE.md` (the
      `calendar/` module, `deriveEpisodeStatus` as the one episode derivation);
      `services/web/CLAUDE.md` (FullCalendar dependency, `status-tone.ts` shared by `StatusBadge` and
      the calendar, the `fc-*` styles in `globals.css` now in use). → T009
      *Done when:* each file names `062` and no statement in them contradicts the diff.
- [ ] **T012** `[docs]` Run the verification in `plan.md` § Verification (typechecks, `api` tests,
      `web` build, catalog check, empty `prisma` and `worker` diffs, `schema.gql` diff) and the manual
      pass for AC-1 → AC-13 (incl. AC-5b), tick each box in `spec.md`, record anything not run live,
      set `status: Implemented` on `spec.md`, `plan.md`, `api/plan.md`, `web/plan.md` and
      `status: Done` here. → T010, T011
      *Done when:* every AC box is ticked or explicitly recorded as not run live with the reason, and
      the four files read `Implemented`.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |
