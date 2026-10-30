---
title: In-app indexer setup — add public film/series indexers without leaving Perceptor
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-10-29
last_updated: 2026-10-30
status: Approved
services: [api, web]
---

# SPEC: In-app indexer setup (`spec.md`)

## Context & Goal

A fresh install ships Prowlarr with zero indexers, and until one exists every release search
returns an empty list. `078-first-step-page` made that visible: an admin-only `/first-step` page
reads `indexerStatus` and walks the administrator through Prowlarr's own UI with its
screenshots — sign in, **Add Indexer**, and for a Cloudflare-fronted tracker put the pre-existing
`flaresolverr` tag in its Tags field (`services/web/src/components/onboarding/IndexerSetupGuide.tsx`).
It works, but it is the one step of first-run setup that sends the administrator out of Perceptor
into a third-party application, and the FlareSolverr half depends on the administrator recognising
which tracker needs it.

Prowlarr already exposes everything needed to do this from inside Perceptor. Its v1 API returns its
whole bundled catalog of indexer definitions (`GET /api/v1/indexer/schema` — 656 definitions,
about 6 MB, on Prowlarr 2.6.5), each one carrying its privacy (`public` / `semiPrivate` /
`private`), protocol, language, Newznab categories and the fields it needs. Measured on that
version: 86 definitions are public torrent indexers, 43 of those carry a film (2000–2999) or TV
(5000–5999) category, and 24 of the 86 carry an `info_flaresolverr` field — Prowlarr's own marker
that the site sits behind Cloudflare. A public torrent definition needs no credentials: its only
non-defaulted field is `baseUrl`, one of its own `indexerUrls`. `api` already talks to this API
(`services/api/src/clients/indexer/client.ts`, `X-Api-Key`, `countIndexers()` for `078`), and
`services/indexer/custom-services.d/20-prowlarr-flaresolverr` already creates the FlareSolverr proxy
and the `flaresolverr` tag at boot.

This feature lets an administrator browse that catalog — narrowed to public torrent indexers that
carry films, series or anime — and add one with one action, from a modal reached from Settings →
Torrent manager (beside the existing indexer API key field) and from `/first-step`. `api` fills the
definition from Prowlarr's own schema, attaches the `flaresolverr` tag when Prowlarr's definition
says the site needs it, asks Prowlarr to test it, and saves it only if the test passes. No sidebar
entry and no Settings tab is added. Private and semi-private indexers, which need credentials, stay
in Prowlarr's UI, which `078`'s walkthrough keeps covering.

A design constraint shapes the whole feature: **Perceptor never recommends a tracker.** The catalog
shown is Prowlarr's, filtered by attributes Prowlarr reports (privacy, protocol, category), listed
alphabetically, with nothing preselected, ranked, featured or preconfigured. No tracker name is
committed anywhere in this repository — code, tests, fixtures, specs, message catalogs or the
landing page (NFR-1).

Pipeline stage touched: **Find release**, configuration side only — searching, ranking and
attaching releases are unchanged; the indexers they query are simply easier to get.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Catalog query)**: `api` must let an administrator list the indexer definitions
      Prowlarr offers, restricted to definitions that are all of: `privacy` public, `protocol`
      torrent, and carrying at least one category (top-level or subcategory) in 2000–2999 (films) or
      5000–5999 (TV). Nothing outside that filter is ever returned, whatever the arguments.
- [ ] **REQ-2 (Catalog entry)**: Each entry must carry the definition's identifier and display name
      as Prowlarr reports them, its language as Prowlarr reports it, which of films / TV / anime it
      carries (anime = Newznab 5070 present), whether Prowlarr marks it as needing FlareSolverr, and
      whether this Prowlarr already holds an indexer of that definition.
- [ ] **REQ-3 (Search)**: The catalog must be narrowable by a case-insensitive substring of the
      display name. With no search text the whole filtered catalog is returned.
- [ ] **REQ-4 (Neutral order)**: Entries must be ordered alphabetically by display name
      (case-insensitive), and by nothing else. No entry is preselected, highlighted, badged as
      recommended or otherwise distinguished beyond the attributes in REQ-2.
- [ ] **REQ-5 (Add)**: An administrator must be able to add one catalog entry by its identifier.
      `api` builds the indexer from that definition's own schema entry: every field at Prowlarr's
      default, `baseUrl` set to the definition's first `indexerUrls` entry, enabled, Prowlarr's
      default app profile. Only identifiers that pass REQ-1's filter are accepted.
- [ ] **REQ-6 (FlareSolverr routing)**: When the definition carries Prowlarr's FlareSolverr marker,
      the added indexer must carry the existing `flaresolverr` tag, so its requests go through the
      in-stack FlareSolverr. When it does not, no tag is attached. `api` never creates the tag or the
      proxy — `20-prowlarr-flaresolverr` owns both.
- [ ] **REQ-7 (Test before save)**: The indexer must be saved only after Prowlarr's own test of it
      passes. A failed test saves nothing and leaves Prowlarr exactly as it was.
- [ ] **REQ-8 (Add is idempotent)**: Adding a definition this Prowlarr already holds must not create
      a second indexer; it returns the existing one with no test and no write.
- [ ] **REQ-9 (Configured list)**: `api` must let an administrator list the indexers this Prowlarr
      currently holds — every one, including private ones added by hand in Prowlarr — with id,
      display name, definition identifier, whether it is enabled and whether it carries the
      `flaresolverr` tag. No field value (credentials, cookies, API keys, URLs) is returned.
- [ ] **REQ-10 (Remove)**: An administrator must be able to remove any indexer REQ-9 lists — including
      private ones added by hand in Prowlarr — after a confirmation naming it. Removal deletes the
      indexer from Prowlarr only; it never touches the `flaresolverr` tag, the proxy, or any download
      or release already attached through that indexer.
- [ ] **REQ-11 (Settings placement)**: Settings → Torrent manager must show, below the indexer API
      key field, an "Indexers" section with the REQ-9 list and an "Add indexer" button that opens the
      catalog in a modal. The section acts immediately, like the torrent-group section already in that
      panel — it does not wait for the panel's Save button. No sidebar entry and no Settings tab is
      added.
- [ ] **REQ-12 (Modal)**: The modal must show a search field, the REQ-1 catalog with each entry's
      name, language and film / TV / anime chips, and per entry an "Add" control that shows its own
      in-flight, added and failed states. An entry already configured shows as added and offers no
      Add. A FlareSolverr-marked entry says so, so the administrator knows why it may be slower.
- [ ] **REQ-13 (First step)**: `/first-step`'s indexer block must offer the same "Add indexer" button
      and modal ahead of the Prowlarr walkthrough. The walkthrough stays whole — all five steps and
      all of `078`'s screenshots — presented as the path for indexers that need an account and
      for administrators who prefer configuring Prowlarr directly.
- [ ] **REQ-14 (Feedback loops close)**: After a successful add or remove, the Torrent manager list, the
      `/first-step` indexer notice (`078` REQ-7/REQ-9) and the sidebar's First step entry (hidden once
      `configuredIndexers > 0`) reflect the new state without a manual reload.
- [ ] **REQ-15 (Translated)**: All new copy lives in `services/web/messages/{en,es}.json` (`es` in
      the existing Rioplatense register). Indexer names and languages are shown as Prowlarr reports
      them, never translated.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (No tracker named)**: No indexer definition name, identifier, URL or domain is committed
      anywhere in the repository — code, tests, fixtures, specs, plans, message catalogs, screenshots'
      alt text, `site/`, `docs/`. Test fixtures use invented definitions (`example-public`, …).
- [ ] **NFR-2 (Filter is a server guarantee)**: REQ-1's filter is enforced by `api` on every read and
      on every add. `web` never receives, and cannot request, a private, semi-private, usenet or
      non-film/TV definition.
- [ ] **NFR-3 (Catalog payload)**: `web` never receives the raw schema. `api` returns only REQ-2's
      fields for the filtered entries. `api` may cache Prowlarr's schema in Redis for up to 6 hours;
      a Redis failure means reading Prowlarr directly, never an error.
- [ ] **NFR-4 (No secret leaks)**: Nothing returned or logged by this feature contains
      `tracker_api_key`, an indexer's field values, or Prowlarr's response bodies verbatim. Prowlarr's
      test-failure detail may be logged by `api` at most truncated, and is never returned to `web`.
- [ ] **NFR-5 (Admin only)**: Every query and mutation here is admin-only; the service token is
      refused, as for `indexerStatus`.
- [ ] **NFR-6 (Unreachable is an error here)**: Unlike `078`'s `indexerStatus`, these operations are
      actions on Prowlarr; an unreachable Prowlarr surfaces as `error.indexer.unavailable`, and the
      Torrent manager panel and `/first-step` must still render in full around that error.
- [ ] **NFR-7 (No schema change)**: No Prisma model, column or migration. Prowlarr is the only store.
- [ ] **NFR-8 (Worker untouched)**: `services/worker` is not in the diff; no pipeline stage changes
      behaviour.
- [ ] **NFR-9 (Prowlarr API drift)**: The fields this feature reads from Prowlarr's schema (privacy,
      protocol, categories, `indexerUrls`, the FlareSolverr marker) are validated on read; an entry
      missing one is dropped from the catalog, never returned half-filled, and never crashes the query.

## GraphQL Contract Delta

```graphql
enum IndexerMediaCategory {
  MOVIES
  TV
  ANIME
}

type IndexerDefinition {
  "Prowlarr's definition identifier (definitionName). Opaque to web."
  definitionName: String!
  name: String!
  "As Prowlarr reports it (e.g. en-US). Null when Prowlarr reports none."
  language: String
  categories: [IndexerMediaCategory!]!
  "Prowlarr marks this site as Cloudflare-fronted; addIndexer will attach the flaresolverr tag."
  needsFlareSolverr: Boolean!
  "This Prowlarr already holds an indexer of this definition."
  configured: Boolean!
}

type ConfiguredIndexer {
  id: Int!
  name: String!
  definitionName: String!
  enabled: Boolean!
  usesFlareSolverr: Boolean!
}

type Query {
  indexerCatalog(search: String): [IndexerDefinition!]!
  configuredIndexers: [ConfiguredIndexer!]!
}

type Mutation {
  addIndexer(definitionName: String!): ConfiguredIndexer!
  "Removes the indexer from Prowlarr. True on success."
  removeIndexer(id: Int!): Boolean!
}
```

All four are guarded by `AdminGuard`.

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| Any of the four called by a non-admin or the service token | `ForbiddenException`, `error.auth.admin_required` | unchanged existing copy |
| Prowlarr refuses / times out / answers non-2xx (any of the four) | `ServiceUnavailableException`, `error.indexer.unavailable` (existing key) | existing copy; `web` shows it inside the section / modal, the page stays rendered (NFR-6) |
| `addIndexer` with an identifier that is unknown or fails REQ-1's filter | `BadRequestException`, `error.indexer.definition_not_allowed` | en: "That indexer can't be added from Perceptor." / es: "Ese indexer no se puede agregar desde Perceptor." |
| `addIndexer`, Prowlarr's test fails | `BadRequestException`, `error.indexer.test_failed` | en: "The indexer didn't respond to the test. Try again later or add it from Prowlarr." / es: "El indexer no respondió a la prueba. Probá más tarde o agregalo desde Prowlarr." |
| `addIndexer` for a FlareSolverr-marked definition and the `flaresolverr` tag does not exist | `ServiceUnavailableException`, `error.indexer.flaresolverr_missing` | en: "FlareSolverr isn't set up in the indexer, so this site can't be reached." / es: "FlareSolverr no está configurado en el indexer, así que este sitio no se puede usar." |
| `addIndexer` for a definition already held | **no error** — returns the existing `ConfiguredIndexer` (REQ-8) | `web` shows the entry as added |
| `removeIndexer` with an id Prowlarr does not hold (already removed, stale list) | `NotFoundException`, `error.indexer.not_found` | en: "That indexer no longer exists." / es: "Ese indexer ya no existe." — `web` refreshes the list |

`web` consumer obligations: the modal handles each `addIndexer` error per entry (the failed state
shows the message on that row; other rows stay usable). `indexerCatalog`/`configuredIndexers`
failing renders the error in place of the list, not an error page. After any successful add, `web`
refreshes so `indexerStatus` (sidebar, `/first-step`) is re-read.

The four new keys are added to `docs/spec/graphql-contract.md`'s vocabulary table beside
`error.indexer.unavailable`.

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1**: Given Prowlarr with no indexers, an admin opens Settings → Torrent manager, clicks
      "Add indexer", and the modal lists only public torrent definitions with a film or TV category,
      alphabetically; the count matches a `jq` filter over `GET /api/v1/indexer/schema` with REQ-1's
      rules run against the same Prowlarr.
- [ ] **AC-2**: Typing part of a name in the modal's search narrows the list to entries whose name
      contains it, case-insensitively.
- [ ] **AC-3**: Adding an entry with no FlareSolverr marker creates exactly one indexer in Prowlarr's
      UI, enabled, with no tags; the Torrent manager list shows it, and searching a title from a film's
      detail page returns releases from it.
- [ ] **AC-4**: Adding an entry with the FlareSolverr marker creates an indexer carrying the
      `flaresolverr` tag (visible in Prowlarr's UI), and its test passed through FlareSolverr.
- [ ] **AC-5 (failure)**: With the `indexer` container stopped, opening the modal shows the
      unreachable message inside the modal; Settings stays rendered; no 500 in `web`'s log.
- [ ] **AC-6 (failure)**: Adding an entry whose site does not answer (e.g. the `flaresolverr`
      container stopped, then adding a FlareSolverr-marked entry) shows `test_failed` on that row and
      Prowlarr's indexer list is unchanged.
- [ ] **AC-7 (failure)**: Calling `addIndexer` directly (GraphQL, admin token) with the identifier of
      a private definition returns `error.indexer.definition_not_allowed` and Prowlarr is unchanged.
- [ ] **AC-8**: Adding the same entry twice leaves one indexer in Prowlarr.
- [ ] **AC-9**: On a fresh install, adding one indexer from `/first-step` flips its notice to the
      "1 indexer configured" confirmation and removes the sidebar's First step entry, with no manual
      reload.
- [ ] **AC-10 (failure)**: A non-admin session calling `indexerCatalog` gets
      `error.auth.admin_required`; the Torrent manager tab is not reachable for them at all.
- [ ] **AC-11**: Every definition name and every `indexerUrls` host in the live
      `GET /api/v1/indexer/schema`, grepped (`git grep -F -i`) against the repository after
      implementation, matches nothing (NFR-1).
- [ ] **AC-12**: Removing an indexer from the Torrent manager list, after confirming, makes it
      disappear from that list and from Prowlarr's UI; the `flaresolverr` tag still exists afterwards.
- [ ] **AC-13 (failure)**: Removing an indexer that was already deleted in Prowlarr's UI (list not
      reloaded) shows `error.indexer.not_found` and the list refreshes without it.

## Out of Scope

- **Private and semi-private indexers.** They need an account and credentials whose fields vary by
  site; rendering Prowlarr's dynamic field schema is a larger feature, and credentials typed into
  Perceptor would be a new secret store. `078`'s walkthrough remains the path.
- **Usenet.** Perceptor's download stage is qBittorrent only.
- **Any curated, recommended, popular or default list of indexers, and any indexer shipped
  preconfigured in the `indexer` image.** Deliberately excluded (Context & Goal, NFR-1).
- **Reworking `/first-step` for administrators who configure Prowlarr directly.** The walkthrough is
  kept whole here; adapting it for those administrators is a later change.
- **Editing an indexer** (base URL, priority, seed ratio, categories, tags). Prowlarr's UI does this.
- **Detecting Cloudflare from a failed test.** Only Prowlarr's own marker decides the tag; a site
  that moved behind Cloudflare without Prowlarr's definition saying so fails its test and is added
  from Prowlarr by hand.
- **Filtering by language.** On Prowlarr 2.6.5 no public film/TV torrent definition reports a
  Spanish language, so a filter would add UI without narrowing anything useful; the language is
  shown on each entry instead.
- **Syncing indexers to other *arr applications.** Prowlarr's Apps feature is unrelated to Perceptor.
