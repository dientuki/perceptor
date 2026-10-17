---
title: Movie Release Dates Display — Tasks
last_updated: 2026-10-16
status: In Progress
---

# TASKS: Movie Release Dates Display (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

No `[worker]` or `[infra]` task: the feature is read-only over columns `075` already stores, with no
schema change, no queue payload change and nothing about how the stack boots.

## Tasks

### Group 1 — contract (`api`)

- [x] **T001** `[api]` Produce the frozen contract delta: new
      `services/api/src/movies/entities/movie-release-type.enum.ts` (`MovieReleaseType`
      `THEATRICAL`/`DIGITAL`/`PHYSICAL`, `registerEnumType`); three nullable `DateTime` fields on
      `Movie` in `movies/entities/movies.entity.ts`; `releaseTypes: [MovieReleaseType!]` (nullable
      list) on `CalendarEntry` in `calendar/entities/calendar-entry.entity.ts`. Descriptions as in
      `../spec.md` § GraphQL Contract Delta. No service or resolver change (`api/plan.md` steps 1–3).
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors and, after boot,
      `git diff services/api/src/schema.gql` shows exactly the three `Movie` fields, the enum and
      `CalendarEntry.releaseTypes` — nothing else; `movie(id)` for a swept film returns non-null
      `digitalReleaseDate` straight off the row.

### Group 2 — calendar expansion (`api`) and consumers (`web`)

The contract exists after T001, so `web` may start in parallel with the rest of `api`. `web`'s
calendar work can only be *verified live* once T003 has landed.

- [x] **T002** `[api] [P]` Write the pure expansion function
      `services/api/src/calendar/movie-release-days.ts` (film's `releaseDate` + three typed dates +
      `{ from, toExclusive }` → ordered `{ date, releaseTypes }[]`; typed dates win, fallback to
      `releaseDate` with `[]` only when all three are null; same-day types merged in fixed order;
      out-of-range days dropped) and its Article IX suite `movie-release-days.spec.ts` with every case
      listed in `api/plan.md` § Tests. → T001
      *Done when:* `bin/npm api test -- movie-release-days` is green with all eight listed cases,
      including "typed dates all out of range, `releaseDate` in range → zero items" and
      "date equal to `toExclusive` excluded".
- [x] **T003** `[api]` Wire it in: widen `MoviesService.findReleasedBetween`'s `where` to an `OR`
      over `releaseDate` and the three typed columns (ownership clause and `include` unchanged);
      replace the single film `push` in `CalendarService.list` with a loop over the function's output
      (drop the `!movie.releaseDate` guard, keep the shorts-capability skip before expansion; episode
      entries carry no `releaseTypes`). Extend `calendar.service.spec.ts`: fixture gains typed dates,
      one film → two entries sharing `mediaId`/`status`, episodes with `releaseTypes` undefined/null,
      ordering still holds. → T002
      *Done when:* `bin/npm api test` is fully green and `bin/comments api` is clean.
- [x] **T004** `[web] [P]` Detail page: extend `Movie` and `GET_MOVIE_QUERY` in
      `services/web/src/actions/movies.ts` with the three dates (listing query untouched); new
      `components/movies/MovieReleaseDates.tsx` rendering only the known dates side by side in order
      theatrical/digital/physical, formatted `toLocaleDateString(locale, { timeZone: "UTC" })`,
      rendering nothing when none is known; mount it under the year line in
      `components/movies/Movie.tsx`; add `movies.detail.releaseTheatrical`/`releaseDigital`/
      `releasePhysical` to `messages/{es,en}.json` (`Cine`/`Digital`/`Físico`,
      `Theatrical`/`Digital`/`Physical`). → T001
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports 0 errors,
      `bin/cli web node scripts/check-messages.mjs` passes, and `/movies/<id>` for a film with
      three typed dates shows the year line unchanged and `Cine … Digital … Físico …` beneath it.
- [x] **T005** `[web]` Calendar: `MovieReleaseType` and `CalendarEntry.releaseTypes` in
      `types/calendar.ts`; select `releaseTypes` in `actions/calendar.ts`; add
      `releaseTypePrefix(types, translate)` to `lib/calendar-label.ts` (known values only, unknown
      skipped, `null` and `[]` both → `""`) and thread `t` through `calendarEntryLabel`; use it in
      `components/calendar/Calendar.tsx` and render the prefix before `entry.title` in
      `CalendarEventContent.tsx` (icon stays first); add `calendar.releaseTheatrical`/
      `releaseDigital`/`releasePhysical` (`(cine)`/`(digital)`/`(físico)`,
      `(theatrical)`/`(digital)`/`(physical)`). Sequential after T004 only because both edit
      `messages/*.json`. → T001, T004
      *Done when:* typecheck 0 errors, `check-messages.mjs` passes, `bin/comments web` clean, and —
      once T003 is in — `/calendar` shows `(cine) <title>` on a film's theatrical day and the hover
      text carries the same prefix.

### Group 3 — verification and docs

- [x] **T006** `[api]` Run the full `api` gate. → T003
      *Done when:* `bin/cli api npx --no tsc --noEmit` 0 errors, `bin/npm api test` green,
      `bin/comments api` clean, `git status --short services/api/prisma` empty, and the
      `schema.gql` diff still matches AC-10.
- [x] **T007** `[web]` Run the full `web` gate, the production build **with the dev stack
      stopped** (a build while it is up clobbers the dev `.next`). → T005
      *Done when:* typecheck 0 errors, `check-messages.mjs` passes, `bin/comments web` clean,
      `bin/npm web run build` exits 0.
- [x] **T008** `[docs] [P]` Add a `093` section to `docs/spec/graphql-contract.md`: the three
      `Movie` fields, `MovieReleaseType`, `CalendarEntry.releaseTypes` (`null` vs `[]`), and that a
      film can now yield several entries keyed by `(mediaId, date)`. → T001
      *Done when:* the section exists and matches `spec.md`'s delta verbatim in substance.
- [x] **T009** `[docs]` Update `CLAUDE.md` files: root pipeline table's "Browse library" row (detail
      page shows typed dates; `/calendar` places a film on each typed day with a label, fallback to
      `releaseDate`, spec ref `093`); the "Register title in DB" row's note that `076` is what reads
      the dates gains "and `093` displays them"; `services/api/CLAUDE.md`'s calendar section
      (`movie-release-days.ts`, widened `findReleasedBetween`); `services/web/CLAUDE.md` § The
      calendar (prefix helper in `lib/calendar-label.ts`) and the new `MovieReleaseDates` component.
      → T003, T005
      *Done when:* each of the four places names `093` and none still says a film is listed on
      `releaseDate` alone.
- [x] **T010** `[docs]` Append a `093` entry to `docs/spec/history.md` with the re-measured counts
      using the commands at the top of that file. → T006, T007
      *Done when:* newest entry is `093` with the measured typecheck/test counts and "no migration".
- [ ] **T011** `[docs]` Manual pass (`plan.md` § Verification) walking AC-1 … AC-10: pick films via
      `bin/mysql`, temporarily null or equalise dates where no real film fits (and revert), check
      detail page and `/calendar` in `es` and `en`, toggle `shorts_enabled`. Tick each AC in
      `spec.md` with a dated confirmation note, set `status: Implemented` on `spec.md`, `plan.md`,
      `api/plan.md`, `web/plan.md`, and `status: Done` here. → T006, T007, T008, T009
      *Done when:* every AC is ticked or explicitly left unticked with its blocker named, and every
      fixture altered for the pass is reverted (`bin/mysql` re-select matches the pre-pass values).

## AC coverage

| AC | Reached by |
| :-- | :-- |
| AC-1, AC-2 | T004, T011 |
| AC-3 | T002 (fallback cases), T003, T004, T011 |
| AC-4, AC-5, AC-6 | T002, T003, T005, T011 |
| AC-7 | T003 (capability skip kept), T011 |
| AC-8 | T004, T005, T011 |
| AC-9 | T003, T005, T011 |
| AC-10 | T001, T006 |

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |
| T011 | docs | Live pass (AC-1..AC-9) needs a signed-in user; no session available and `calendar`/`movie` reject the worker credential (`Not authenticated`) | The user to open `/movies/<id>` and `/calendar` in `es` and `en` (films 1, 2, 3, 9 cover distinct and same-day dates; a null-dates film needs a temporary fixture) |
