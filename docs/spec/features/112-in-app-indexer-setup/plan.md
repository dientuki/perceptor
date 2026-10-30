---
title: In-app indexer setup — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-10-30
status: Approved
---

# PLAN: In-app indexer setup (`plan.md`)

## Approach

Everything this feature reads or writes lives in Prowlarr; Perceptor stores nothing (NFR-7). `api`
extends the two places that already talk to Prowlarr instead of adding a third:
`ProwlarrClient` (`services/api/src/clients/indexer/client.ts`) gains the raw calls — read the
schema, list/create/delete indexers, list tags and app profiles — on top of its existing private
`request()`, which is widened to carry a method and a JSON body. `IndexerService`
(`services/api/src/indexer/indexer.service.ts`) gains the feature's rules, and `IndexerResolver`
gains the four admin-only operations next to `indexerStatus`. The client stays a pure adapter and
the service owns caching and policy, the split `040` set for search.

The policy is two pure functions in a new `services/api/src/indexer/indexer-catalog.ts`, so the
rules the spec cares most about are testable without HTTP:

- **`toCatalogEntry(definition)`** — returns an `IndexerDefinition` (minus `configured`) or `null`.
  `null` for anything that is not public, not torrent, carries no category in 2000–2999 / 5000–5999
  (top level or subcategory), or is missing a field the feature relies on (NFR-9). This single
  function is REQ-1's filter for **both** the catalog read and the add path (NFR-2), so the two can
  never disagree.
- **`buildIndexerPayload(definition, { appProfileId, flareSolverrTagId })`** — the body for
  Prowlarr's create call: the schema entry as Prowlarr returned it, `enable: true`, `appProfileId`,
  `baseUrl` set to `indexerUrls[0]`, `tags: [flareSolverrTagId]` when the definition carries the
  `info_flaresolverr` field, `[]` otherwise (REQ-5, REQ-6).

**Test before save is Prowlarr's own create.** Prowlarr's `POST /api/v1/indexer` (without
`forceSave=true`) runs the indexer's test and answers `400` with a list of validation failures when
it fails, saving nothing. That gives REQ-7 atomically in one call, where a separate
`POST /indexer/test` followed by a create would leave a window and double the requests to the site.
The `api` implementer confirms this behaviour against the dev stack's Prowlarr before relying on it
(Risks); if it does not hold on the pinned version, the fallback is the explicit test call first.

**Caching.** The raw schema is about 6 MB. `IndexerService` caches the *projection* — the
already-filtered list of catalog entries — in Redis for 6 hours (`indexer:catalog`), never the raw
body, with the same try/catch read-through posture as `search()` (NFR-3). `configured` is not
cached: it is computed per call from a live `GET /api/v1/indexer`, matched on `definitionName`, so
an indexer added or removed in Prowlarr's UI shows correctly immediately. The add path reads the
schema entry from Prowlarr directly, not from the cache, since it needs the full entry with its
fields.

**`web` never depends on Prowlarr to render a page.** The indexer list and the catalog are fetched
by client components through server actions after the page renders, so an unreachable Prowlarr
shows an inline error inside the section or modal and the Settings tab and `/first-step` stay whole
(NFR-6). The alternative — fetching `configuredIndexers` in `settings/page.tsx`'s `Promise.all` —
was rejected: one Prowlarr outage would turn all of Settings into an error page. One shared
`AddIndexerButton` (button + modal) is mounted in two places: inside a new indexer section of
`TorrentManagerPanel`, and on `/first-step` above `IndexerSetupGuide`'s walkthrough, which stays
unchanged (REQ-13). After any successful add or remove, `web` calls `router.refresh()` so the
layout re-reads `indexerStatus` and the sidebar's First step entry and `/first-step`'s notice follow
(REQ-14).

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the four operations, the four error keys and the Prowlarr calls `web` consumes. |
| 2 | `web` | Renders and calls them; nothing to call before step 1 lands. |
| 3 | `[docs]` | `docs/spec/graphql-contract.md` (operations + four keys in the vocabulary table), the root `CLAUDE.md` Find release row, `services/{api,web}/CLAUDE.md`. |

Once this plan is Approved the contract is frozen, so `web` may start in parallel with `api`
against the spec's SDL; its manual pass waits for `api`. The docs step can run alongside either.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. Things an
implementer will be tempted to change and must not:

- **`indexerCatalog(search)` takes a search argument even though the filtered catalog is small
  (43 entries on Prowlarr 2.6.5).** `web` uses it (debounced) rather than filtering locally; do not
  drop the argument or move the search to the client.
- **No category, language, privacy or protocol argument.** The filter is fixed server-side
  (NFR-2). Adding a `privacy` argument "for flexibility" is exactly the hole NFR-2 closes.
- **`addIndexer` for an already-held definition returns the existing indexer, not an error.**
  Idempotent on purpose (REQ-8); do not add an `already_configured` key.
- **`ConfiguredIndexer` has no URL, no fields, no tags list** — only `usesFlareSolverr`. Returning
  more is an NFR-4 leak, not a convenience.
- **`removeIndexer` accepts any id Prowlarr holds**, including private indexers added by hand
  (REQ-10). Do not restrict it to catalog-eligible ones.
- **Unreachable Prowlarr is an error here** (`error.indexer.unavailable`), unlike `indexerStatus`.
  Do not copy `status()`'s catch-and-resolve posture into these operations.

## Migrations

None.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| A Prowlarr `400` validation-failure body on create is parsed as a created indexer | `addIndexer` reports success, `web` shows the row as added, Prowlarr holds nothing; searches stay empty with no error anywhere | The client checks `res.ok` before parsing (existing `request()` shape) and maps a create `400` to `error.indexer.test_failed`; a test asserts a `400` never resolves |
| Prowlarr's create does **not** run the test on the pinned version | A dead site is saved; searches quietly return nothing from it | Implementer verifies once against the dev stack's Prowlarr before relying on it; fallback is an explicit `POST /api/v1/indexer/test` first (same mapping) |
| The filter leaks a private, usenet or non-film/TV definition | Shown in the modal and addable; no error anywhere (NFR-2) | One pure `toCatalogEntry` used by both read and add; fault-injected tests per rule |
| A definition missing a field the feature reads | Catalog query crashes, or an entry is returned half-filled (NFR-9) | `toCatalogEntry` returns `null` on anything missing; tested |
| Adding the same definition twice | Two indexers, every search result doubled, no error | Live `GET /indexer` match on `definitionName` before create (REQ-8); tested |
| The `flaresolverr` tag is missing (init script failed) | Without a check the indexer is saved untagged and silently fails every search | Explicit `error.indexer.flaresolverr_missing` before create; tested |
| Stale cached catalog after a Prowlarr definitions update | A removed definition is listed and fails on add | Add re-reads the schema live and answers `definition_not_allowed` for an unknown id; 6-hour TTL bounds staleness |
| A tracker name lands in the repo (NFR-1) | Nothing fails — it just sits in git | Fixtures use invented names; AC-11's grep runs in the verify step |
| `web` fetches the list in a page `Promise.all` | One Prowlarr outage makes all of Settings an error page | Client-side fetch through actions (Approach); AC-5 |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test -- indexer
bin/cli web npx --no tsc --noEmit
bin/npm web run lint
bin/comments api
bin/comments web
bin/cli web node scripts/check-messages.mjs
```

NFR-1 (AC-11): from the dev stack's Prowlarr, dump every definition name and every `indexerUrls`
host of `GET /api/v1/indexer/schema` to a scratch file outside the repo, and run
`git grep -F -i -f <that file>` over the repository — it must match nothing.

Manual pass, admin session, dev stack:

1. Prowlarr with no indexers → Settings → Torrent manager → "Add indexer": modal lists only
   public torrent film/TV definitions, alphabetically; count equals the `jq` filter of AC-1. Type a
   fragment → list narrows (AC-2).
2. Add an entry without the FlareSolverr marker → appears in the section; Prowlarr UI shows it
   enabled, no tags; search a film from its detail page → releases from it (AC-3).
3. Add a FlareSolverr-marked entry → Prowlarr UI shows the `flaresolverr` tag (AC-4).
4. Add the same entry again → still one in Prowlarr (AC-8).
5. Stop `flaresolverr`, add another marked entry → `test_failed` on that row, Prowlarr unchanged
   (AC-6). Start it again.
6. Remove one from the section → gone from the section and Prowlarr; tag still exists (AC-12).
   Delete one in Prowlarr's UI, then remove it from the stale section → `not_found`, list
   refreshes (AC-13).
7. Stop `indexer` → open the tab and the modal → inline unreachable message, Settings fully
   rendered, no 500 in `web`'s log (AC-5).
8. GraphQL playground, admin token: `addIndexer` with a private definition's identifier →
   `definition_not_allowed` (AC-7). Non-admin token: `indexerCatalog` → `admin_required` (AC-10).
9. Fresh state (no indexers) → `/first-step` → add one → notice flips to the count `1` and the
   sidebar's First step entry disappears without a reload (AC-9).
