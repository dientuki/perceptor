---
title: Environment Panel — Tasks
last_updated: 2026-09-14
status: Done
---

# TASKS: Environment Panel (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[infra]` | Repo-root and third-party-container territory — `bin/`, `docker-compose.yaml`, `.env.example`, `services/*/Dockerfile`, the container config under `services/torrent/` and `services/indexer/`, and `docs/spec/docker/`. The difference from `[docs]` is executable config versus prose, so these carry a real *Done when*. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

A task is one coherent change an agent can finish and verify on its own. If it cannot be checked off
without also doing something in another service, it is scoped wrong — split it.

## Tasks

### Group 1 — stack wiring

- [x] **T001** `[infra]` Add `USE_TRAEFIK`, `QBITTORRENT_WEBUI_PORT` and `INDEXER_PORT` to the `api`
      service's `environment:` block in `docker-compose.yaml`, with one brief note naming what reads
      them (`environmentInfo`, the Settings screen's Environment tab) and that they drive no behaviour.
      Do **not** add `API_PORT` — `PORT=${API_PORT}` is already there. `.env.example` is unchanged: all
      three variables already exist in it.
      *Done when:* `docker compose config | grep -A 30 '^  api:' | grep -E 'USE_TRAEFIK|QBITTORRENT_WEBUI_PORT|INDEXER_PORT'`
      prints three lines whose values are interpolated from the local `.env` (no empty strings, no
      literal `${...}`), `docker compose config >/dev/null` exits 0, and `git status --short` shows
      `docker-compose.yaml` modified and nothing under `services/`.

### Group 2 — the contract

- [x] **T002** `[api]` Create `src/environment/` — `environment.types.ts` (the `ENVIRONMENT_CONFIG`
      token and `EnvironmentConfig`), `environment.module.ts` (the `process.env` factory: the allowlist
      is exactly `USE_TRAEFIK`, `DOMAIN`, `WEB_PORT`, `PORT`, `QBITTORRENT_WEBUI_PORT`,
      `INDEXER_PORT`), `entities/environment-info.entity.ts`, `environment.service.ts` (the whole
      derivation, pure over injected config) and `environment.resolver.ts` (`@UseGuards(AdminGuard)`
      **per method**). Register `EnvironmentModule` in `src/app.module.ts`. Copy
      `src/media-roots/media-roots.module.ts`'s factory-behind-a-token shape; **do not** copy
      `MediaRoot`'s `label` field. No host fallback anywhere: `null` is the specified answer in port
      mode. → T001
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors; after one boot,
      `grep -A 8 'type EnvironmentInfo' services/api/src/schema.gql` and
      `grep -A 6 'type EnvironmentEndpoint' services/api/src/schema.gql` match `../spec.md`'s delta
      field-for-field, including every nullability; and `git status --short services/api/prisma` is
      empty.
- [x] **T003** `[api]` Write `src/environment/environment.service.spec.ts`, opening with the
      Article IX header naming the class of failure it prevents. Cases, each verified fault-injection
      style (remove the rule, watch the case fail): every `endpoints[].url` and
      `expectedUploadEndpoint` is `null` when `useTraefik` is false; the returned keys are **exactly**
      the contract's, top level and per endpoint (AC-8); Traefik mode derives all four URLs and
      `expectedUploadEndpoint` from a domain; `useTraefik: true` with a `null` domain still yields
      `null` URLs (never `http://api.null/uploads`); an unset port reads `null`, not `0`. → T002
      *Done when:* `bin/npm api test` is green and its totals are reported against the 471 tests / 43
      suites baseline; deleting the port-mode null-guard in `environment.service.ts` makes the suite
      fail, and restoring it makes it pass.

### Group 3 — the consumer

Everything here depends on T002: the contract must exist and be queryable before `web` consumes it.
This group may run **alongside T003** — different service, same single dependency.

- [x] **T004** `[web]` Create `src/types/environment.ts` (mirror the query by hand, every nullable
      field typed `| null`) and `src/actions/environment.ts` (`getEnvironmentInfo()` on
      `src/actions/media-roots.ts`'s shape — `redirectToClearSession`, never
      `redirectIfUnauthenticated`, since it runs during a Server Component's render pass — selecting
      every field of the delta and handling `error.auth.admin_required`). → T002
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports 0 errors, and the query string in the
      action selects all four `EnvironmentInfo` fields plus all three `EnvironmentEndpoint` fields.
- [x] **T005** `[web]` Create `src/components/settings/EnvironmentPanel.tsx` — read-only, one
      renderable component in the file, no form control of any kind — rendering routing mode, the
      domain (marked *not in effect* when `useTraefik` is false), the four endpoints in the order
      received (a `null` url renders as a dash or an explicit "not derivable", **never** a link and
      never a fabricated `localhost`), the upload endpoint with its consistency verdict (compare
      strings as given — no trailing-slash or case normalization), the api/web domain disagreement
      warning naming `docker compose up -d --force-recreate api web`, the list of `.env` variables to
      edit plus the recreate command, and — **only** when `useTraefik` is false — the host-address
      guidance. `uploadEndpoint === null` renders "not configured"; the literal `undefined` must never
      reach the DOM. Add its `settings.environment` keys to **both** `messages/en.json` and
      `messages/es.json`, `es` in the catalog's existing Rioplatense register. → T004
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports 0 errors,
      `bin/cli web node scripts/check-messages.mjs` exits 0, and
      `bin/cli web npx --no biome check src/components/settings/EnvironmentPanel.tsx` is clean.
- [x] **T006** `[web]` Wire the tab. In `src/app/(dashboard)/settings/page.tsx`: add
      `getEnvironmentInfo()` to the existing `Promise.all` (leave the sequential `isAdmin`/
      `notFound()` check above it untouched) and read `process.env.PUBLIC_UPLOAD_URL` /
      `process.env.DOMAIN` directly in that Server Component, passing all three down. In
      `SettingsForm.tsx`: append `environment` to `TABS` and to `tabItems` **last**, with
      `Container` from `lucide-react` and the `settings.tabs.environment` key (added to both
      catalogs); render `<EnvironmentPanel>` as a **sibling of the `<form>`, not a child**, and give
      the `<form>` `hidden` while that tab is active. **Hide the form; never conditionally render
      it** — `FormData` reads the DOM, so unmounting it destroys every unsaved edit on the other six
      tabs with no error anywhere. → T005
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports 0 errors, `bin/npm web run build`
      exits 0, `bin/cli web node scripts/check-messages.mjs` exits 0 (AC-9); and in the browser
      `/settings` shows *Environment* as the last tab with the `Container` icon, that tab shows **no
      *Guardar* button**, and editing a field on the General tab, switching to Environment and
      switching back leaves the edit intact (REQ-10).

### Group 4 — verification and docs

- [x] **T007** `[infra]` Run the acceptance matrix from `../plan.md` § Verification against the local
      stack. **Snapshot `.env` first (`cp .env .env.055-backup`) and restore it at the end** — every
      step below mutates it and recreates containers. Steps: (1) Traefik mode with a matching
      `PUBLIC_UPLOAD_URL` → consistent verdict, four URLs, ports (AC-1); (2) change `DOMAIN` only,
      recreate `api web` → inconsistent verdict showing the expected value (AC-2); (3)
      `USE_TRAEFIK=false`, recreate → no URL built from `localhost` or any invented host, host
      guidance present (AC-3); (4) back to `true`, recreate → guidance gone (AC-4); (5) change
      `DOMAIN`, recreate **only** `web` → api/web disagreement reported with the recreate command
      (AC-5); (6) comment out `PUBLIC_UPLOAD_URL`, recreate `web` → "not configured", no `undefined`
      in the DOM, another tab still saves (AC-7); (7) as a non-admin, `/settings` still 404s (AC-6).
      → T006
      *Done when:* each of the seven steps observed and recorded in this file's checkbox, `.env`
      restored byte-for-byte (`diff .env .env.055-backup` empty, backup then removed), and the stack
      left running on the configuration it started from.
- [x] **T008** `[docs] [P]` Add a `### The environment panel is read-only (055-environment-panel)`
      section to `docs/spec/graphql-contract.md`, following the `034-jellyfin-library-reconciliation`
      section's shape: the SDL, the per-method `AdminGuard`, why every URL field is nullable and why
      `null` is correct rather than a `localhost` fallback, why `EnvironmentEndpoint` carries no
      `label`, and why `PUBLIC_UPLOAD_URL` is deliberately absent from the query. → T002
      *Done when:* the section exists, its SDL matches `services/api/src/schema.gql` verbatim, and it
      is listed in the file's own section index ordering (after the `054` section).
- [x] **T009** `[docs] [P]` Update the affected `CLAUDE.md` files. `services/api/CLAUDE.md`: add
      `environment/` to the module map. `services/web/CLAUDE.md`: the seventh Settings tab, and the
      new structural rule that a read-only panel renders outside `SettingsForm`'s `<form>` with the
      form hidden rather than unmounted. Root `CLAUDE.md`: refresh the *Current state* counts only.
      **No pipeline stage changed status** — do not edit the root pipeline table. → T006
      *Done when:* the three files reflect the change, `grep -n "environment" services/api/CLAUDE.md`
      finds the module-map entry, and the root pipeline table is untouched in the diff.
- [x] **T010** `[docs]` Walk every acceptance criterion in `../spec.md`, tick each box against the
      evidence from T003/T006/T007, and set `status: Implemented` on `spec.md`, `plan.md`,
      `infra/plan.md`, `api/plan.md` and `web/plan.md`; set this file to `status: Done`. Update
      `last_updated` on each. → T007, T008, T009
      *Done when:* all nine `AC-` boxes in `spec.md` are `[x]`, no file in this directory still reads
      `status: Approved`, and any criterion that could not be reached is recorded in § Blocked below
      instead of being ticked.

## Blocked

Anything an agent stopped on rather than working around. Empty is the normal state; a non-empty entry
is a decision waiting for a human.

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

Contract problems always land here (Constitution, Article VIII): an agent that finds the GraphQL
delta wrong stops and reports, it does not amend the delta from inside its slice.
