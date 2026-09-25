---
title: TMDB key onboarding on the home page — Tasks
last_updated: 2026-09-25
status: In Progress
---

# TASKS: TMDB key onboarding on the home page (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task. |
| `[docs]` | Documentation only. Owned by the orchestrator. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

## Tasks

### Group 1 — contract (`api`)

- [x] **T001** `[api] [P]` Add `TmdbHttpError` (`src/clients/tmdb/errors.ts`) carrying `status`,
      thrown by `fetchResults`/`fetchOne` in `src/clients/tmdb/client.ts` with today's message text;
      test in `client.spec.ts`.
      *Done when:* `bin/npm api test -- clients/tmdb` passes, including a non-ok response asserting
      `instanceof TmdbHttpError` and `status`.
- [x] **T002** `[api] [P]` Add `MediaCapabilities.catalogKeyConfigured` (entity +
      `MediaCapabilitiesService.read()`, trimmed non-empty `movie_db_api_key`); regenerate
      `schema.gql`; tests for empty / whitespace / absent / set.
      *Done when:* `git diff services/api/src/schema.gql` shows exactly `catalogKeyConfigured: Boolean!`
      and `bin/npm api test -- media-capabilities` passes.
- [x] **T003** `[api]` Add `MEDIA_CATALOG_UNAUTHORIZED` (`error.media.catalog_unauthorized`) to
      `src/i18n/error-keys.ts` + `messages.en.ts`; map TMDB 401 to it in
      `src/media/popular-media.service.ts` only; tests: 401 → new key, 500/network → still
      `catalog_unavailable`, no cache write on 401. → T001
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors and `bin/npm api test` is all
      green with a count above 726; `git status --short services/api/prisma` empty.

### Group 2 — consumer (`web`)

- [x] **T004** `[web]` Add `catalogKeyConfigured` to `types/media.ts` and
      `MEDIA_CAPABILITIES_QUERY`; change `getPopularMedia` (`actions/media.ts`) to return
      `{ items } | { error, errorKey }` via `toActionError` (auth still via `redirectToClearSession`),
      adapting `app/(dashboard)/page.tsx` to the new shape with no visible change yet. → T002, T003
      *Done when:* `bin/cli web npx --no tsc --noEmit` 0 errors; `/`, `/movies` render as before
      against a stack with a valid key.
- [x] **T005** `[web]` Create `components/billboard/TmdbKeyOnboarding.tsx` (props `isAdmin`,
      `keyRejected`) per `web/plan.md` Step 2, with `en`/`es` copy under
      `billboard.tmdbOnboarding.*` plus `error.media.catalog_unauthorized`; wire it into `page.tsx`
      (no key → panel with no `popularMedia` call; any `catalog_unauthorized` → panel with notice,
      shown once). → T004
      *Done when:* `bin/npm web run build` exits 0, `bin/cli web node scripts/check-messages.mjs`
      reports no drift, and `/` with an empty key shows the reason followed by five steps.

### Group 3 — verification and docs

- [x] **T006** `[docs]` Manual pass from `plan.md` § Verification covering AC-1 … AC-7 (admin and
      non-admin, empty key, `garbage` key, unreachable TMDB, valid key, every link clicked,
      non-admin GraphQL read). → T005
      *Done when:* each AC is recorded as confirmed or explicitly not run, with the reason.
      *Result (2026-09-25):* AC-1 to AC-5 and AC-7 (response half) **not run** — no login available in
      the session, and AC-3/AC-5 would rewrite the installation's TMDB key. AC-6: signup, login and
      api-terms answer 200; `/settings/api` answers 401 anonymously (needs a TMDB login), so that
      link was not confirmed by hand. AC-7 drift half: `check-messages` OK at 553 keys.
- [x] **T007** `[docs]` Update root `CLAUDE.md`: Search catalog row (`071` in specs, one sentence on
      `catalogKeyConfigured` + onboarding panel) and a "Current state" entry with measured counts.
      → T006
      *Done when:* the row cites `071` and the counts come from commands run in this task.
- [ ] **T008** `[docs]` Tick the acceptance criteria in `spec.md`, set `status: Implemented` on
      `spec.md`, `plan.md`, `api/plan.md`, `web/plan.md`, and `status: Done` here. → T007
      *Done when:* `grep -n "^status" docs/spec/features/071-*/**.md` shows no `Approved`/`Draft`.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |
