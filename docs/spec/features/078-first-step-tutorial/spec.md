---
title: First-step page — TMDB key plus indexer setup
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-09-28
last_updated: 2026-09-28
status: Approved
services: [api, web]
---

# SPEC: First-step page — TMDB key plus indexer setup (`spec.md`)

## Context & Goal

`071-tmdb-key-onboarding` fixed half of a fresh install's first five minutes: with
`movie_db_api_key` empty, `/` no longer renders `error.media.catalog_unavailable` but a panel
explaining why Perceptor needs the administrator's own TMDB key and how to obtain one
(`services/web/src/components/billboard/TmdbKeyOnboarding.tsx`). The other half is undocumented
anywhere in the product. A fresh install also ships Prowlarr with **zero indexers** — `bin/install`
and `install.sh` generate `INDEXER_API_KEY`, the `indexer` container writes it into `config.xml`,
the api's settings seed fills `tracker_api_key`, and `services/indexer/custom-services.d/20-prowlarr-flaresolverr`
registers a FlareSolverr proxy and creates the `flaresolverr` tag — but it deliberately attaches
that tag to nothing, because which trackers sit behind Cloudflare is a human decision
(`014-dev-stack-flaresolverr`). So every piece of plumbing is wired and every search still returns
nothing, with no error to explain it: `searchTorrents` answers an empty list, exactly as it would
for a title no tracker carries.

This feature adds one admin-only page, `/first-step`, that carries both halves. It repeats the
TMDB block verbatim — the same component `/` already renders, so the copy exists in one place — and
adds an indexer block: how to reach Prowlarr and sign in (the login is the shared `ADMIN_USER` one,
`061-admin-password-off-env`), how to add a plain public indexer, and how to add a Cloudflare-fronted
one by putting the pre-existing `flaresolverr` tag in its Tags field. Unlike `071`, which ruled
screenshots out, this block **is** three screenshots of Prowlarr's own UI: the steps are
click-paths inside a third-party application whose field names mean nothing in prose.

So that the page is not purely decorative, `api` gains one read-only query telling an admin how
many indexers Prowlarr currently holds, and whether Prowlarr answered at all. The indexer block
opens with a notice when that count is zero — the missing piece of feedback a new install has no
way to discover today.

Pipeline stage touched: **Find release**, read side only — nothing about searching, ranking,
adding or downloading changes. The **Search catalog (TMDB)** stage is referenced, not changed: the
TMDB panel is reused as-is and `/` keeps today's behaviour.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Route)**: `web` must serve an admin-only page at `/first-step`. A non-admin who
      opens it gets the same 404 an admin-only page gives today (`/users`), not a partial render.
- [ ] **REQ-2 (Reachable)**: The page must be reachable from the sidebar's administration group
      (beside Settings and Users), visible to admins only.
- [ ] **REQ-3 (TMDB block repeated)**: The page must show the whole TMDB onboarding block — the
      privacy reason first, then the five steps with their links — identical in content to what `/`
      shows when no key is configured, with no second copy of the copy or the links.
- [ ] **REQ-4 (Home unchanged)**: `/` keeps `071`'s behaviour exactly: the panel when no key is
      configured, the rejected-key notice on `error.media.catalog_unauthorized`, the billboard
      otherwise. This feature adds no redirect, link or wording change to `/`.
- [ ] **REQ-5 (TMDB block always shown)**: On `/first-step` the TMDB block is shown whether or not a
      key is already configured — this is a reference page, not a conditional alert. When a key
      **is** configured the block must carry a short "already configured" marker so an admin is not
      left wondering whether they must redo it.
- [ ] **REQ-6 (Indexer count exposed)**: `api` must let an administrator learn how many indexers the
      configured Prowlarr holds, and whether Prowlarr answered, without exposing any indexer's
      credentials, categories or configuration.
- [ ] **REQ-7 (Zero-indexer notice)**: When the count is zero and Prowlarr answered, the indexer
      block must open with a notice stating that no indexer is configured and that every release
      search will return nothing until one is.
- [ ] **REQ-8 (Unreachable is its own state)**: When Prowlarr did not answer, the indexer block must
      say the indexer could not be reached — never "zero indexers", which is a different problem
      with a different fix.
- [ ] **REQ-9 (Count satisfied is silent)**: When the count is one or more, the notice must be
      replaced by a confirmation naming the count; the steps stay visible either way.
- [ ] **REQ-10 (Indexer steps)**: The indexer block must list, in order:
      1. Open the indexer's web UI. The page must show the URL this installation actually answers
         on — the routed host in Traefik mode, or the published port otherwise — and link it when a
         URL can be derived. It must never print a fabricated host.
      2. Sign in with the same username and password as Perceptor's administrator account: one
         login serves Perceptor, the torrent client and the indexer (`061`). *(screenshot 1)*
      3. Add a plain public indexer: **Add Indexer**, pick one, **Test**, **Save**. *(screenshot 2)*
      4. Add a Cloudflare-fronted indexer the same way, and additionally put the existing
         `flaresolverr` tag in its **Tags** field, which is what routes that indexer's requests
         through the in-stack FlareSolverr. The tag and the proxy already exist; nothing is created
         by hand. *(screenshot 3)*
      5. Return to Perceptor and search a title from its detail page; releases now appear.
- [ ] **REQ-11 (API key is not a step)**: The indexer block must state that the indexer API key needs
      no copying — the installer already wired it — so an admin does not go looking for the field.
- [ ] **REQ-12 (Screenshots)**: The three screenshots must be static assets committed under
      `services/web/public/images/first-step/`, each with descriptive alt text from the message
      catalog, each rendered at a size where Prowlarr's field labels are legible, and each clickable
      to view full size.
- [ ] **REQ-13 (Translated)**: All page copy lives in `services/web/messages/{en,es}.json` (`es` in
      the existing Rioplatense register). URLs, the literal tag name `flaresolverr`, and Prowlarr's
      own button labels quoted in the steps are not translated.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (No secret leaks)**: REQ-6's query returns a count and a reachability flag only —
      never `tracker_api_key`, never an indexer's own credentials, never Prowlarr's response
      verbatim.
- [ ] **NFR-2 (Unreachable is an outcome, not an error)**: A Prowlarr that refuses, times out or
      answers non-2xx must resolve REQ-6's query successfully with the unreachable state, not throw
      `error.indexer.unavailable`. A page that cannot load because the indexer is down is the bug
      this rule prevents.
- [ ] **NFR-3 (One call per page load)**: Opening `/first-step` makes at most one request to
      Prowlarr and no request to TMDB (Deployment scale: conserve external API calls). The count is
      not polled and not cached.
- [ ] **NFR-4 (No schema change)**: No Prisma model, column or migration. Everything REQ-6 needs is
      already in Settings (`tracker_host`, `tracker_port`, `tracker_api_key`).
- [ ] **NFR-5 (Worker untouched)**: No pipeline stage changes behaviour; `services/worker` is not in
      the diff.
- [ ] **NFR-6 (Screenshot staleness)**: A screenshot is replaced as a single-file change when
      Prowlarr redesigns the screen. No code reads the images' contents, and the steps' prose must
      stand on its own if an image fails to load.

## GraphQL Contract Delta

```graphql
type IndexerStatus {
  "Indexers currently configured in Prowlarr. 0 when reachable is false."
  configuredIndexers: Int!
  "Whether Prowlarr answered this request at all."
  reachable: Boolean!
}

type Query {
  indexerStatus: IndexerStatus!
}
```

`indexerStatus` is guarded by `AdminGuard`, the same as `environmentInfo`.

The indexer URL the page shows (REQ-10 step 1) is **not** new contract: `/first-step` reads the
existing admin-only `environmentInfo` query and takes the `indexer` entry of its `endpoints` list —
`url` when routing derives one, `port` otherwise. Its `null` semantics are already fixed by
`055-environment-panel` NFR-1 and are what REQ-10's "never a fabricated host" rests on.

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| `indexerStatus` called by a non-admin or by the service token | `ForbiddenException`, `extensions.i18n.key = error.auth.admin_required` | unchanged existing copy; `web` never issues the call for a non-admin (REQ-1 404s first) |
| `indexerStatus`, Prowlarr refuses / times out / answers non-2xx | **no error** — resolves `{ configuredIndexers: 0, reachable: false }` (NFR-2) | en: "The indexer could not be reached." / es: "No se pudo contactar al indexer." — `web` copy, REQ-8 |
| `indexerStatus`, Prowlarr answers with an empty list | **no error** — resolves `{ configuredIndexers: 0, reachable: true }` | en: "No indexer is configured yet…" / es: "Todavía no hay ningún indexer configurado…" — `web` copy, REQ-7 |
| `environmentInfo`, no derivable URL for `indexer` | unchanged: `url: null`, `port` reported | `web` prints the port and the host the admin is already browsing, with no link (REQ-10) |

`web` consumer obligations: render three distinct indexer-block headers from
(`reachable`, `configuredIndexers`) — unreachable (REQ-8), reachable-and-zero (REQ-7),
reachable-and-positive (REQ-9). Treat `configuredIndexers` as advisory copy only; nothing on the
page branches on it beyond which notice is shown.

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1**: Given a fresh install (no TMDB key, no indexers), an admin opening `/first-step`
      sees the TMDB block with the privacy reason, the five steps and step 5 linking to
      `/settings`, followed by the indexer block opening with the zero-indexer notice.
- [ ] **AC-2 (failure)**: Given `docker compose stop indexer`, an admin opening `/first-step` gets a
      fully rendered page whose indexer block says the indexer could not be reached — not a
      zero-indexer notice, not an error page, not a 500.
- [ ] **AC-3 (failure)**: Given a non-admin session, opening `/first-step` returns 404, and the api
      log shows no `indexerStatus` and no `environmentInfo` call for that request.
- [ ] **AC-4**: After adding one indexer in Prowlarr and reloading `/first-step`, the notice is
      replaced by the confirmation naming the count `1`; the five steps are still shown.
- [ ] **AC-5**: With `USE_TRAEFIK=true` and a domain, step 1 links to `http(s)://indexer.<domain>`
      and that link opens Prowlarr. With `USE_TRAEFIK=false`, step 1 shows `INDEXER_PORT` with no
      link and no invented hostname.
- [ ] **AC-6**: Given a TMDB key already configured, `/first-step` still shows the whole TMDB block,
      marked as already configured, and `/` still shows the billboard (REQ-4, REQ-5).
- [ ] **AC-7**: The three screenshots load on `/first-step`, each field label in them is readable at
      the rendered size, and each opens full size when clicked.
- [ ] **AC-8**: The sidebar shows the `/first-step` entry for an admin and not for a non-admin.
- [ ] **AC-9**: Following step 4 on a Cloudflare-fronted indexer (tag `flaresolverr` in its Tags
      field), a `searchTorrents` for a title that tracker carries returns rows — proving the
      screenshot documents the step that actually works.
- [ ] **AC-10**: `bin/cli web node scripts/check-messages.mjs` reports no `en`/`es` drift.
- [ ] **AC-11**: `git status --short services/api/prisma` is empty and
      `git diff --stat services/worker` is empty (NFR-4, NFR-5).

## Out of Scope

- **Anything appearing automatically.** No badge, banner, redirect or sidebar dot announces the
  zero-indexer state outside `/first-step`. Deciding that a fresh install should be nagged is a
  separate call; this feature only makes the state knowable on the page that explains it.
- **Configuring indexers from Perceptor.** Prowlarr's UI stays the place indexers are added. Proxying
  its add/test/save flow through `api` would duplicate an application the stack already ships.
- **Attaching the `flaresolverr` tag automatically.** `014` decided this stays manual — which
  indexers are Cloudflare-fronted is a human judgement, and guessing it wrong either wastes
  FlareSolverr on every request or leaves a tracker broken.
- **Screenshots of TMDB's UI.** `071` ruled them out and that stands: TMDB's steps read fine as
  prose with links. Prowlarr's do not, which is why only the indexer block carries images.
- **Validating the TMDB key or the indexer API key when saved.** Still a Settings-side idea, still
  needing an outbound call on save (`071` § Out of Scope).
- **A `/tutorial` alias.** One route, `/first-step`. A second path to the same page is a redirect
  nobody asked for.
- **Extending the page to the torrent client, the media server or HTTPS setup.** The two things a
  fresh install cannot work without are the catalog key and one indexer. Everything else has a
  working default.
