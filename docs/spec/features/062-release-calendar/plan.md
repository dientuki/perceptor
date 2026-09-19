---
title: Release Calendar — Implementation Plan
spec_version: 0.2.0
last_updated: 2026-09-19
status: Implemented
---

# PLAN: Release Calendar (`plan.md`)

## Approach

One new read-only query, `calendar(from, to)`, answered by a new `api` module (`src/calendar/`) that
**composes** the two existing library services rather than reading Prisma on its own. `MoviesService`
and `ShowsService` each grow one ranged, user-scoped read that returns rows with the status already
derived by the same code their detail pages use; `CalendarService` only filters by media-type
capability, groups episodes (REQ-4/REQ-7/REQ-7b) and orders the result. This keeps NFR-1 (one status
truth) structural: the calendar never calls `deriveTitleStatus` itself.

The one piece of the status derivation that is not already reachable is the per-episode season-pack
lift, which today lives in `ShowsService`'s private `deriveSeasonEpisodeStatuses`. It moves into
`services/api/src/pipeline-status/pipeline-status.ts` as a pure `deriveEpisodeStatus(...)` beside
`deriveTitleStatus`/`isLiftedBySeasonPack`, and both the detail page path and the new ranged read call
it. That is a consolidation (Article X), not a new layer: there is one derivation after this feature,
where a naïve calendar would have created a second.

Grouping and counting live in `api`, not `web`. The alternative — return one row per episode and group
in the browser — would have put REQ-7's status precedence in a service with no test suite (`web`
CLAUDE.md § Tests), and made `web` retype a rule nobody could verify. Grouping server-side also keeps
the contract's `completedCount`/`episodeCount` meaningful.

On `web`, `/calendar`'s empty page (`033`) renders the uncommitted
`services/web/src/components/calendar/Calendar.tsx`, rewritten from the TailAdmin demo into a
read-only month view. FullCalendar's function-valued `events` source is the "ajax": it is called with
the visible range on first mount and on every prev/next/today, and calls a new server action. Nothing
touches the URL (REQ-2). The template's `fc-*` styles already in `globals.css` are reused; the status
colours follow the existing `StatusBadge` mapping, which moves to a shared helper so the calendar and
the pill cannot drift.

Dates cross the boundary as plain `YYYY-MM-DD` strings in both directions. Release dates are stored as
UTC midnight (`new Date('2026-09-19')` at registration/hydration), so `api` compares and formats in
UTC, and `web` hands FullCalendar all-day date strings, which it places by calendar day in any browser
timezone (NFR-4).

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the query, the two error keys and the extracted derivation `web` depends on. |
| 2 | `web` | Consumes `calendar` and the two keys; cannot be verified against a query that does not exist. |
| 3 | `docs` (orchestrator) | Append a `062` section to `docs/spec/graphql-contract.md`; update root `CLAUDE.md`'s "Browse library" row and `web`/`api` `CLAUDE.md`. |

Steps 1 and 2 **can run in parallel** once this plan is approved — the contract is frozen in
`spec.md` and `web` can write its action and component against it — but step 2's live verification
waits for step 1. The `@fullcalendar/*` install is the one `web` task with no dependency on `api` at
all.

## Contract Freeze

`spec.md` § GraphQL Contract Delta is frozen as of `status: Approved`. Things an implementer will be
tempted to change and must not:

- **`date`, `from`, `to` are `String`, not `DateTime`.** Every other date in the schema is a
  `DateTime`; this one is deliberately a calendar day. A `DateTime` would reintroduce the timezone
  shift NFR-4 forbids the moment `web` formats it in the browser's zone.
- **`status` is `String!`, not an enum** — same as every status field since `043`.
- **`mediaId` means Show.id for `EPISODES`, not Episode.id** — it is the id the detail route takes.
- **`episodeCount`/`completedCount` are non-null for every `EPISODES` entry, including single-episode
  ones** (`1`/`0|1`). The "no count for a single episode" rule of REQ-7b is display, and belongs to
  `web`; `api` does not null them out for a group of one.
- **Disabled media types are filtered, not refused.** `api` must not call
  `MediaCapabilitiesService.assertEnabled` here.
- **Kind `SHORT` is decided by `Movie.isShort` alone** — never by runtime.

If the contract has to change mid-flight: stop, amend `spec.md`, re-approve, re-brief both `api` and
`web` (Article VIII).

## Migrations

None. No schema change; `Movie.releaseDate`, `Episode.releaseDate`, `Movie.isShort`,
`UserMovie`/`UserShow` already exist. `git status --short services/api/prisma` must stay empty.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| Off-by-one at the range edges | A release on the last visible day (or the first) silently missing — no error, just an empty cell. `to` is inclusive in the contract; FullCalendar's `end` is exclusive. | `api` converts `to` into an exclusive upper bound (`to + 1 day`, UTC) in exactly one place, covered by a spec test at both edges; `web` subtracts one day from FullCalendar's `end` before calling. |
| Timezone shift | A `2026-09-19` release shows on the 18th for Buenos Aires — no error anywhere. | UTC arithmetic only on `api`; `web` never builds a `Date` from `date`, only passes the string to FullCalendar as an all-day event. AC-11 in the manual pass. |
| Calendar status diverges from detail page | Episode under an in-flight season pack reads `MISSING` on the calendar, `QUEUED` on `/shows/<id>`. | `deriveEpisodeStatus` extracted and shared, with the existing `shows.service.spec.ts` lift cases still green; the ranged read loads season `mediaSources` with the same filter the detail read uses. |
| Group precedence wrong | A group with one `ERROR` among `COMPLETED` reads green. | Pure grouping function with a spec test per REQ-7 branch plus the REQ-7b *Reacher* case. |
| Ownership leak | Another user's title on the calendar. | Both ranged reads use the same `users: { some: { userId } }` clause as `findAll`; service principal resolves to `''` as in `ShowsResolver`. Test asserts the clause. |
| Stale template left behind | The demo's add/edit modals or `timeGrid` buttons ship, letting users "create" events that vanish on reload. | `web` plan rewrites the component outright; AC-13 in the manual pass. |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
git status --short services/api/prisma
bin/cli web npx --no tsc --noEmit
bin/npm web run build
bin/cli web node scripts/check-messages.mjs
git diff --stat services/worker
```

Expected: 0 typecheck errors in both services, every `api` suite green (count up from 559/46), empty
`prisma` status, build exits 0, no catalog drift, empty `worker` diff. `schema.gql`'s diff is exactly
the enum, the type and the one query in `spec.md`.

Manual pass against a running stack (`bin/dev -d`), covering AC-1 → AC-13:

1. Open `/calendar` → current month, a registered film on its release day, click → `/movies/<id>` (AC-1, AC-8 with a short).
2. Next / prev / today → entries change, address bar stays `/calendar`, reload opens the current month (AC-2).
3. A show with a same-day multi-episode drop → one `S0xE01–E0n · k/n` entry; mark progress by attaching sources and watch colours (AC-3, AC-4, AC-5, AC-5b).
4. Sign in as a second user → the first user's titles absent (AC-6).
5. Toggle `shows_enabled` off in Settings → episodes disappear, films remain (AC-7).
6. In the GraphiQL/`curl` against `api`: a 122-day range and `2026-13-01` → the two keyed errors (AC-9).
7. `docker compose stop api`, move months → inline translated error, navigation still responds (AC-10).
8. Browser devtools sensor timezone `America/Argentina/Buenos_Aires` → a release stays on its day (AC-11).
9. Switch UI locale `es`/`en` → month names, weekdays, "hoy"/"today", legend follow (AC-12).
10. Click an empty day, try to drag an entry → nothing happens (AC-13).
