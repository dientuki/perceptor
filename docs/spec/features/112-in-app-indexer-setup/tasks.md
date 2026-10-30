---
title: In-app indexer setup — Tasks
last_updated: 2026-10-30
status: Done
---

# TASKS: In-app indexer setup (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[docs]` | Documentation, the contract doc and the manual pass. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |
| `[x]` `[~]` | `[~]` = implemented, awaiting a manual run by the maintainer. |

**Measuring.** The stack running on this host may be the end-user install, not this checkout, so
`bin/cli`/`bin/npm` may find no container. In that case, run each *Done when* command through the
throwaway container described in memory (`measuring-without-dev-stack`): `docker run --rm --user
1000:1000 -v "$PWD/services/<svc>":/app -w /app -e HOME=/tmp node:24.18.0-alpine sh -c '<command>'`.
Report which form was used.

**No tracker names (spec NFR-1).** No task may commit a real indexer definition name, identifier,
URL or domain — not in code, tests, fixtures, messages, comments or these docs. Fixtures use
invented definitions (`example-public`, `example-private`, …).

## Tasks

### Group 1 — `api`: Prowlarr facts and independent pieces

- [x] **T001** `[api]` Verify Prowlarr's create and delete semantics against **this checkout's dev
      stack** Prowlarr (never another install on the host): `POST /api/v1/indexer` without
      `forceSave` runs the indexer's test and answers `400` with a validation-failure array when it
      fails, saving nothing; `DELETE /api/v1/indexer/{id}` answers `404` for an unknown id; the
      first entry of `GET /api/v1/appprofile` is a valid `appProfileId`. Use an invented-unreachable
      `baseUrl` for the failing create so nothing is saved; delete anything a successful probe
      created (`api/plan.md` Step 1).
      *Done when:* the report states each of the three answers with the observed status codes, and
      Prowlarr's indexer list is the same before and after. If create does not test, the report
      says so and T005 uses `POST /api/v1/indexer/test` first.
- [x] **T002** `[api]` Widen `ProwlarrClient.request()` in `src/clients/indexer/client.ts` to a
      method, query and JSON body (GET default; non-2xx throws before any body parse; the status is
      available to the caller; no `res.json()` on an empty `DELETE`), add `getIndexerSchema()`,
      `listIndexers()`, `createIndexer(body)`, `deleteIndexer(id)`, `listTags()`,
      `listAppProfiles()` with `Array.isArray` on every list, the raw shapes in
      `src/clients/indexer/types.ts`, and extend `client.spec.ts` (`api/plan.md` Steps 2–3) → T001
      *Done when:* `bin/npm api test -- clients/indexer` passes, including a case per new call that
      a non-2xx rejects without resolving as data, and the existing `search`/`countIndexers` cases
      still pass unchanged.
- [x] **T003** `[api] [P]` Add `src/indexer/indexer-catalog.ts` (`toCatalogEntry`,
      `buildIndexerPayload`) and `indexer-catalog.spec.ts` with its Article IX header
      (`api/plan.md` Step 4; spec REQ-1, REQ-2, REQ-5, REQ-6, NFR-2, NFR-9).
      *Done when:* `bin/npm api test -- indexer-catalog` passes with one fault-injected case per
      rule: private, semi-private, usenet and no-film/TV each → `null`; a film category only as a
      subcategory → kept; missing `indexerUrls` or `fields` → `null`; 5070 → `ANIME`; a
      FlareSolverr-marked definition's payload carries the tag id and an unmarked one carries `[]`;
      `baseUrl` = `indexerUrls[0]`, `enable: true`.
- [x] **T004** `[api] [P]` Add `INDEXER_DEFINITION_NOT_ALLOWED`, `INDEXER_TEST_FAILED`,
      `INDEXER_FLARESOLVERR_MISSING`, `INDEXER_NOT_FOUND` to `src/i18n/error-keys.ts` and their
      English text from the spec's error table to `src/i18n/messages.en.ts` (`api/plan.md`
      Step 10).
      *Done when:* `bin/npm api test -- messages.en` passes and the four keys resolve to
      `error.indexer.definition_not_allowed`, `…test_failed`, `…flaresolverr_missing`,
      `…not_found`.

### Group 2 — `api`: service and contract

- [x] **T005** `[api]` Add `catalog(search?)`, `configured()`, `add(definitionName)`, `remove(id)`
      to `IndexerService` (`src/indexer/indexer.service.ts`) with the `indexer:catalog` Redis
      read-through (6 h, projection only), live `configured` matching, alphabetical order, and the
      add sequence and error mapping of `api/plan.md` Steps 5–8; extend `indexer.service.spec.ts`
      → T002, T003, T004
      *Done when:* `bin/npm api test -- indexer.service` passes with fault-injected cases: an
      already-held definition makes no create call; a create `400` rejects `test_failed` and never
      resolves; a marked definition with no `flaresolverr` tag rejects `flaresolverr_missing` with
      no create call; an unknown or private id rejects `definition_not_allowed`; `remove` of an id absent
      from the list rejects `not_found` with no delete call; `catalog` with Redis throwing still answers; `status()`'s existing cases
      unchanged.
- [x] **T006** `[api]` Add `src/indexer/entities/indexer-definition.entity.ts` (with the
      `IndexerMediaCategory` enum) and `configured-indexer.entity.ts`, and the four operations in
      `src/indexer/indexer.resolver.ts`, each `@UseGuards(AdminGuard)` (`api/plan.md` Steps 9, 11)
      → T005
      *Done when:* `bin/cli api npx --no tsc --noEmit` exits 0, `bin/npm api test` and
      `bin/comments api` pass, and after a dev boot the `src/schema.gql` diff contains exactly the
      spec's SDL (enum, two types, two queries, two mutations) and nothing else.

### Group 3 — `web`

Everything here consumes the contract T006 produced.

- [x] **T007** `[web]` Add `IndexerMediaCategory`, `IndexerDefinition`, `ConfiguredIndexer` to
      `src/types/indexer.ts` and `getIndexerCatalogAction`, `getConfiguredIndexersAction`,
      `addIndexerAction`, `removeIndexerAction` to `src/actions/indexer.ts`, each returning
      `{ ok: true, … } | { ok: false, error }` via `toActionError` (`web/plan.md` Steps 1–2) → T006
      *Done when:* `bin/cli web npx --no tsc --noEmit` exits 0.
- [~] **T008** `[web]` Build `IndexerCatalogRow.tsx`, `AddIndexerModal.tsx` and
      `AddIndexerButton.tsx` in `src/components/indexers/`, mount `AddIndexerButton` on
      `src/app/(dashboard)/first-step/page.tsx` above `IndexerSetupGuide` (guide unchanged), and add
      their `indexers.*` copy plus the four `errors.indexer.*` translations to `messages/en.json`
      and `messages/es.json` (`web/plan.md` Steps 3, 5, 6) → T007
      *Done when:* on `/first-step`, "Add indexer" opens the modal listing the catalog
      alphabetically with language and category chips; typing narrows it; a FlareSolverr-marked
      row shows its note; an already-configured row shows as added with no Add; a successful add
      flips the notice and hides the sidebar's First step entry without a reload; with `indexer`
      stopped the modal shows the unreachable message inline.
- [~] **T009** `[web]` Build `RemoveIndexerModal.tsx` and `IndexerSection.tsx` in
      `src/components/indexers/`, render the section in `TorrentManagerPanel.tsx` below the indexer
      API key field, and add their copy to both catalogs (`web/plan.md` Steps 4–6) → T008
      *Done when:* Settings → Torrent manager lists configured indexers (FlareSolverr shown); Add
      reuses the modal and the list updates after an add; Remove asks with the indexer's name and
      the row disappears; removing one already deleted in Prowlarr shows "Ese indexer ya no existe."
      and the list reloads; with `indexer` stopped the tab renders with the error inline; no
      horizontal scroll at 375 px.
- [~] **T010** `[web]` Verify the slice → T009
      *Done when:* `bin/cli web npx --no tsc --noEmit`, `bin/npm web run lint`, `bin/comments web`
      and `bin/cli web node scripts/check-messages.mjs` pass.

### Group 4 — verification and docs

- [x] **T011** `[docs] [P]` Add a `112-in-app-indexer-setup` section to
      `docs/spec/graphql-contract.md` (the enum, both types, the four operations, the error table and
      what `web` does with each) and the four keys to the vocabulary table beside
      `error.indexer.unavailable` → T006
      *Done when:* the section matches `spec.md` § GraphQL Contract Delta on SDL and error keys,
      and the vocabulary row lists all four new keys.
- [x] **T012** `[docs] [P]` Update the root `CLAUDE.md` "Find release" row (in-app catalog of
      public film/TV torrent indexers, add/remove, automatic `flaresolverr` tag; add `112` to its
      specs), `services/api/CLAUDE.md`'s `indexer/` and `clients/indexer/` entries, and
      `services/web/CLAUDE.md`'s onboarding / Settings notes (`components/indexers/`, the two mount
      points); append a measured `docs/spec/history.md` entry → T010
      *Done when:* each of the four files mentions `112`, and the history entry carries measured
      typecheck/test counts and "no migration".
- [x] **T013** `[docs]` Run AC-11's grep (definition names and `indexerUrls` hosts from the dev
      Prowlarr's schema, dumped outside the repo, `git grep -F -i -f`), then walk AC-1 … AC-13 per
      `plan.md` § Verification, tick each box in `spec.md` (or annotate why it stays open), and set
      `status: Implemented` on `spec.md`, `plan.md`, `api/plan.md`, `web/plan.md` and `status: Done`
      here → T011, T012
      *Done when:* the grep matches nothing, every AC is ticked or annotated with its blocker, and
      the five files carry their closing status.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |
| T008, T009 | web | Typecheck, comments and message parity pass; UI behavior not yet observed in a browser (needs an admin session) | Admin signs in to the browser pane, then the orchestrator walks the manual pass |
| T010 | web | `bin/npm web run lint` fails repo-wide on existing errors (146 before this change, 145 after; the touched files are clean) | Maintainer decision; not caused by 112 |
