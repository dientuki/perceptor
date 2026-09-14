---
title: Environment Panel
spec_version: 0.1.0
author: Juan Farias
created_at: 2026-09-11
last_updated: 2026-09-14
status: Implemented
services: [infra, api, web]
---

# SPEC: Environment Panel (`spec.md`)

## Context & Goal

Nothing in the product shows how the installation is actually reachable. Whether domain routing is
on, which domain answers, which port each service is published on, and above all which URL the
browser is handed to upload a file to — all of it lives in `.env` on the host and is invisible from
inside the app. That gap produced a real failure that took a full debugging session to name:
`PUBLIC_UPLOAD_URL` ships in `.env.example` as a literal (`http://api.perceptor.local/uploads`) that
neither installer used to derive, so any installation whose `DOMAIN` was something else silently
carried an upload endpoint pointing at a host that does not resolve. `services/web/src/actions/
uploads.ts` reads that variable server-side and hands it to the browser's tus client as `endpoint`;
the browser then fails before sending a single byte, with a network-level error carrying no HTTP
status at all (`response code: n/a`), indistinguishable from a CORS rejection. Commit `a57ebfc`
closed the install-time half — `bin/install` and `install.sh` now derive the value from
`USE_TRAEFIK`/`DOMAIN`/`API_PORT`. It does not close the post-install half: both installers skip
their questions once `.env` exists, so every later domain change or routing-mode switch is a hand
edit of four variables (`USE_TRAEFIK`, `DOMAIN`, `COMPOSE_PROFILES`, `PUBLIC_UPLOAD_URL`) that must
stay consistent with each other, validated by nothing.

This feature adds a read-only **Environment** tab, last in `/settings`, that shows how the
installation is reachable right now — as each container has it loaded, not as `.env` reads on disk —
and tells the administrator exactly which variables to edit and what to recreate for a new value.
Its one piece of derived intelligence is a consistency verdict on the upload endpoint: with domain
routing on, the expected value is fully determined by the mode and the domain, so the panel can say
whether the loaded one matches and show the correct one when it does not. That is the check that
would have turned this bug into a five-second read.

The panel is read-only by nature, not by timidity. These values are interpolated by `docker compose`
at container-creation time: Traefik's `Host()` rules are container labels, and `api`'s CORS allowlist
is built once in `services/api/src/main.ts` from `process.env.DOMAIN` at boot. No running process can
rewrite either. Writing them from the app would require write access to the host's `.env` and to the
Docker socket — which today only `traefik` holds, and only read-only. No pipeline stage in the root
`CLAUDE.md` changes status; this is a new read surface over configuration that already exists.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Environment tab)**: `/settings` must show a seventh tab, **last** in the tab list,
      labelled from the message catalog (`en`: `Environment`, `es`: `Entorno`) and carrying
      lucide-react's `Container` icon. It sits behind the screen's existing admin gate — a non-admin
      still gets the route's `notFound()`, unchanged.
- [ ] **REQ-2 (Routing mode)**: The tab must state whether domain routing (Traefik) is enabled or
      disabled for this installation.
- [ ] **REQ-3 (Domain)**: The tab must show the domain the installation is configured with, and when
      routing is disabled must mark it as not in effect rather than hiding it — an administrator
      about to switch modes needs to see the value that will start applying.
- [ ] **REQ-4 (Access endpoints)**: For each of the four routed services (`web`, `api`, `torrent`,
      `indexer`) the tab must show its published port and, when routing is enabled, the effective URL
      that reaches it.
- [ ] **REQ-5 (Upload endpoint)**: The tab must show the endpoint the browser is actually handed for
      uploads, read from the `web` container's own loaded value — the one access value that is not
      derived from domain and port, and the one that broke.
- [ ] **REQ-6 (Consistency verdict)**: When routing is enabled, the tab must state whether the upload
      endpoint of REQ-5 matches what the mode and domain imply, and when it does not, must show the
      expected value alongside the loaded one.
- [ ] **REQ-7 (Restart needed)**: When the domain `api` has loaded differs from the one `web` has
      loaded, the tab must report that the two containers disagree and name the command that
      recreates them — this is the observable signature of an `.env` edit applied to one container
      and not the other.
- [ ] **REQ-8 (How to change)**: The tab must show which `.env` variables to edit for a new value or
      a mode switch, and the command that makes the edit take effect. This is the whole
      "how do I change it" half of the feature: an administrator must not have to leave the screen to
      learn that editing `.env` alone changes nothing until containers are recreated.
- [ ] **REQ-9 (Host guidance, port mode only)**: When routing is **disabled**, the tab must
      additionally explain that the upload endpoint has to carry an address the *browser* can reach —
      the host's own LAN address, never `localhost` when the browser may be another device — and that
      no container can determine that address on its own, so it is set by hand. This block must
      **not** appear when routing is enabled, where the value is fully derivable.
- [ ] **REQ-10 (Nothing is saved)**: The tab must contribute no form field and must offer no control
      that edits or submits any value on it. The screen's shared save action must not read anything
      from this tab.
- [ ] **REQ-11 (Unset upload endpoint)**: When `PUBLIC_UPLOAD_URL` is unset in `web`, the tab must
      render it as not configured and the rest of the screen must keep working. It must not throw,
      and must not render the string `undefined`.

The infra-facing half of REQ-2/REQ-4: the `api` container must have the routing mode and the four
published ports available to it. Today it receives `DOMAIN`, `WEB_PORT` and `PORT` (its own published
port) and none of `USE_TRAEFIK`, `QBITTORRENT_WEBUI_PORT`, `INDEXER_PORT`.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Never invent a host address)**: With routing disabled, no service URL may be
      fabricated. `localhost` is not a substitute for the host's address — the browser reading this
      panel may be on a different machine than the one running the stack, which is exactly the case
      REQ-9's guidance exists for. An underivable URL is reported as absent, never guessed.
- [ ] **NFR-2 (Allowlist, never a dump)**: The new query returns a fixed, enumerated set of
      access-related values. It must never return `process.env` wholesale, and must never expose
      `JWT_SECRET`, `SERVICE_TOKEN`, `DATABASE_URL` or any database credential, `INDEXER_API_KEY`,
      `TMDB_API_KEY`, or any secret held in Settings.
- [ ] **NFR-3 (Admin only)**: The new query carries `AdminGuard` **per method**, following the
      `ffprobe-logs.resolver.ts` split rather than a class-level guard.
- [ ] **NFR-4 (Values as loaded, never as written)**: The panel reports what each container currently
      holds in its environment. It never reads `.env` from disk — that file is not mounted into any
      container, and the difference between "what is loaded" and "what the file says" is precisely
      what REQ-7 exists to surface.
- [ ] **NFR-5 (Purely additive)**: No existing behaviour changes. The upload path, the CORS
      configuration in `main.ts`, the Traefik labels and every existing setting are untouched. This
      feature adds one query, one tab and three environment passthroughs.

## GraphQL Contract Delta

```graphql
type EnvironmentEndpoint {
  id: String!
  port: Int
  url: String
}

type EnvironmentInfo {
  useTraefik: Boolean!
  domain: String
  endpoints: [EnvironmentEndpoint!]!
  expectedUploadEndpoint: String
}

type Query {
  environmentInfo: EnvironmentInfo!
}
```

Semantics `web` retypes by hand and the schema cannot express:

| Field | Meaning | When it is `null` |
| :-- | :-- | :-- |
| `useTraefik` | `true` when the installation routes by domain (`USE_TRAEFIK`) | never |
| `domain` | the configured domain, reported in **both** modes (REQ-3) | the variable is unset or empty |
| `endpoints` | exactly four entries, ids `web`, `api`, `torrent`, `indexer`, in that order | never (the list is never empty) |
| `endpoints[].port` | that service's published port | the variable backing it is unset |
| `endpoints[].url` | `http://<domain>` for `web`, `http://<id>.<domain>` for the other three | `useTraefik` is false, or `domain` is null (NFR-1) |
| `expectedUploadEndpoint` | `http://api.<domain>/uploads` — what REQ-6 compares against | `useTraefik` is false, or `domain` is null |

`EnvironmentEndpoint` carries **no label**: service display names are user-facing copy and belong to
`web`'s message catalog, keyed off `id` (`018-ui-i18n` — `api` never produces display text). All URLs
are `http`; the stack defines a `websecure` entrypoint but no router uses it, and modelling TLS is out
of scope below.

The two values this query does **not** carry, because only `web` holds them, are the loaded
`PUBLIC_UPLOAD_URL` (REQ-5) and `web`'s own `DOMAIN` (REQ-7's other half). `web` reads both from its
own environment server-side, exactly as `createUploadTicketAction` already reads the first.

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| Caller is not an administrator | `ForbiddenException` via `AdminGuard`, existing key `error.auth.admin_required` | existing `errors.auth.admin_required` catalog copy, unchanged |
| Caller is a service principal | `ForbiddenException`, same key | same |

No new error key. `web`'s settings page already gates on `isAdmin` and calls `notFound()` before
fetching, sequentially and never inside a `Promise.all` — the refusal above is the API-level backstop,
not a path the UI reaches. The read function follows `getMediaRoots`'s shape, including
`redirectToClearSession` (it runs during a Server Component's render pass).

## Data Model Changes

None. No Prisma model, field, enum or migration — every value is read from the process environment,
and nothing here is persisted.

## Acceptance Criteria

- [x] **AC-1**: Given `USE_TRAEFIK=true`, `DOMAIN=perceptor.local` and
      `PUBLIC_UPLOAD_URL=http://api.perceptor.local/uploads`, when an administrator opens `/settings`
      and selects the last tab, then it reads *Environment*, shows routing as enabled, shows
      `perceptor.local`, lists four services with their ports and URLs
      (`http://perceptor.local`, `http://api.perceptor.local`, `http://torrent.perceptor.local`,
      `http://indexer.perceptor.local`), and marks the upload endpoint as consistent.
- [x] **AC-2** *(failure path — the bug that motivated this)*: Given `USE_TRAEFIK=true` and
      `DOMAIN=ptor.local` while `PUBLIC_UPLOAD_URL` is still `http://api.perceptor.local/uploads`,
      when the tab is opened, then it flags the upload endpoint as inconsistent and shows
      `http://api.ptor.local/uploads` as the expected value.
- [x] **AC-3** *(failure path)*: Given `USE_TRAEFIK=false`, when the tab is opened, then no service
      URL is shown as an absolute URL built from `localhost` or from any invented host, and the REQ-9
      host guidance block is present.
- [x] **AC-4**: Given `USE_TRAEFIK=true`, when the tab is opened, then the REQ-9 host guidance block
      is absent.
- [x] **AC-5** *(failure path)*: Given `DOMAIN` changed in `.env` and only `web` recreated
      (`docker compose up -d --force-recreate web`), when the tab is opened, then it reports that
      `api` and `web` disagree on the domain and names the command that recreates both.
- [x] **AC-6** *(failure path)*: Calling `environmentInfo` as a non-admin returns
      `error.auth.admin_required` and no payload; a non-admin opening `/settings` still gets a 404,
      unchanged.
- [x] **AC-7**: Given `PUBLIC_UPLOAD_URL` unset in the `web` container, when the tab is opened, then
      the upload endpoint renders as not configured, the string `undefined` appears nowhere, and every
      other tab still saves normally.
- [x] **AC-8**: `bin/npm api test` is green, and a new `api` test asserts the resolver's payload keys
      are exactly the allowlist of NFR-2 — it fails if a secret-bearing variable is added to the
      response.
- [x] **AC-9**: `bin/cli web npx --no tsc --noEmit` reports 0 errors, `bin/npm web run build` exits 0,
      and `bin/cli web node scripts/check-messages.mjs` exits 0 — no catalog drift between `en.json`
      and `es.json` for the new keys.

## Out of Scope

- **Editing any of these values from the panel.** Asked and deliberately answered no: they are
  host-level values interpolated at container-creation time, so applying one would need write access
  to the host's `.env` plus the Docker socket to recreate containers — a privilege only `traefik`
  holds today, read-only. The panel tells the administrator what to edit; the edit stays a host
  action.
- **A reachability test from the browser.** A "Probar" button fetching the upload endpoint from the
  administrator's own browser would prove DNS, routing and CORS in one click — the single most
  diagnostic thing this screen could do. Explicitly not included in this iteration. If added later it
  must be honest about what it cannot distinguish: a DNS failure, a refused connection and a rejected
  CORS preflight all surface identically to page JavaScript as a rejected promise with no status.
- **Restarting or recreating containers from the UI.** Same privilege argument as the first item.
- **A `bin/toggle-traefik` helper** that rewrites the four variables together from the terminal. A
  reasonable companion to this panel and a separate, infra-only change; not required for it.
- **`COMPOSE_PROFILES` automation.** The panel may report the routing mode but does not manage the
  profile that decides whether the `traefik` container starts at all. Getting that pair out of sync is
  a real failure — it is the difference between `USE_TRAEFIK=true` and Traefik actually running — and
  deserves its own treatment rather than a side effect here.
- **TLS / the `websecure` entrypoint.** Every router in `docker-compose.yaml` binds `entrypoints=web`
  (port 80); the panel reports `http` URLs and models no certificate, redirect or HTTPS mode. Adding
  HTTPS is its own feature and would change what this panel reports.
- **Validating that a domain resolves, or that a port is actually bound.** Both are host-side facts a
  container cannot establish for the browser's benefit (NFR-1's reasoning), and attempting either
  from inside the stack would produce confidently wrong answers.
