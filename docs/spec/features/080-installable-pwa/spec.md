---
title: Installable PWA (LAN-scoped)
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-09-28
last_updated: 2026-09-28
status: Approved
services: [web]
---

# SPEC: Installable PWA (LAN-scoped) (`spec.md`)

## Context & Goal

Perceptor is already served as a web application a household opens from a phone, a tablet or a TV
browser, and after `079-mobile-legibility-pass` it is legible there. What it is not is *installable*:
opening it means finding a tab, a bookmark or an IP address, and once open it wears the browser's
chrome — an address bar, a tab strip and a back gesture that belong to the browser rather than to
the app. The pieces of a PWA that exist today are partial and inert. `services/web/src/app/manifest.json`
declares a name, two maskable PNG icons (`public/web-app-manifest-192x192.png`,
`public/web-app-manifest-512x512.png`) and `display: standalone`, but no `id`, `start_url`, `scope`,
`description` or non-maskable icon, and a `theme_color`/`background_color` of `#ffffff` that no
screen in this application actually uses — `layout.tsx` puts `dark:bg-gray-900` on `<body>`. There is
no service worker anywhere in the tree, and Chromium will not offer to install a site that has no
fetch handler, so the manifest has never done anything. `layout.tsx` sets
`apple-mobile-web-app-title` and `application-name` in `<head>`, which is the beginning of the iOS
half and not the whole of it.

The environment this runs in is what keeps the feature small. Perceptor is a LAN application with no
route to the internet: there is nothing remote to cache, no CDN to survive, no push service to
subscribe to, and the one thing worth reaching — `api` — is on the same LAN and is either up or the
application has nothing to show. So this feature deliberately caches **nothing**: no build assets, no
HTML, no GraphQL response. Every request goes to the network exactly as it does today. The single
exception is an offline fallback document the service worker keeps so that a failed navigation lands
on a Perceptor screen instead of the browser's dinosaur. That choice is not laziness; a precache is
how a self-hosted app ends up showing a stale interface after `docker compose pull && up -d`, and an
installation that updates by pulling a new image must never do that.

The second constraint is the secure context. A service worker registers only on HTTPS or on
`localhost`, so a stack reached at `http://192.168.1.50:3000` cannot be installed at all — no
workaround exists on the browser side. `066-https-local-ca` already gives this repository the answer:
`USE_HTTPS=true` behind Traefik issues a leaf from a local CA, and Settings → Environment already
shows the HTTPS badge and links `/ca.crt` for per-device trust. This feature makes that relationship
explicit rather than mysterious: with HTTPS on, the app installs; with it off, the app behaves
exactly as it does today and Settings says why.

Once this ships, a device on the LAN that trusts the local CA can install Perceptor from its browser
and launch it as a standalone app with its own icon and window, and a navigation that fails while the
stack is down shows a Perceptor offline screen with a retry. This is a `services/web` presentation
and packaging change. It touches no pipeline stage in the root `CLAUDE.md`, no Prisma model and no
GraphQL field. Article VII does not require a spec for a change confined to one service with no
schema or contract delta; this one is written anyway, on the precedent of `079`, because the caching
policy is a decision future work must not quietly reverse.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Complete manifest)**: The web manifest must carry everything a browser needs to treat
      Perceptor as an installed application: a stable `id`, `name`, `short_name`, `description`,
      `lang`, `start_url` and `scope` at the application root, `display: standalone`, a
      `theme_color`/`background_color` drawn from the application's own palette rather than plain
      white, and icons at 192 and 512 covering both `purpose: any` and `purpose: maskable`.
- [ ] **REQ-2 (Registered service worker)**: `web` must serve a service worker from the application
      root and register it from the client on every page load, so that a browser in a secure context
      offers installation.
- [ ] **REQ-3 (Cache nothing)**: The service worker must never serve a stored copy of a document,
      script, stylesheet, font, image or `api` response. Every request is passed through to the
      network. The only resource it may store is the offline fallback document of REQ-4. A
      Perceptor installation updated to a new image must show the new interface on the next reload,
      with no version-skew step, no "update available" prompt and no forced re-install.
- [ ] **REQ-4 (Offline fallback)**: A *navigation* request that fails at the network layer must
      resolve to a Perceptor offline screen — branded, styled, translated through the `en`/`es`
      catalogs like every other screen — stating that the server is unreachable and offering a retry
      that re-attempts the original destination. A failed sub-resource or `api` request gets no
      fallback; it fails as it does today.
- [ ] **REQ-5 (Secure-context gating)**: Outside a secure context the application must behave
      exactly as it does today: no registration attempt, no console error, no visible difference.
- [ ] **REQ-6 (Installability is stated, not guessed)**: Settings → Environment must show whether
      this installation can be installed as an app, and when it cannot, name the reason (HTTPS is
      off) next to the existing HTTPS badge and `/ca.crt` link, so an administrator is not left
      wondering why the browser never offers it.
- [ ] **REQ-7 (iOS home screen)**: An iPhone or iPad adding Perceptor via *Add to Home Screen* must
      launch it standalone with a correct icon and status-bar treatment, which means the Apple-specific
      `<head>` tags beside the ones already there, since iOS reads those rather than the manifest for
      part of this.
- [ ] **REQ-8 (Clean takeover and removal)**: A newly published service worker must take control of
      open clients immediately rather than waiting for every tab to close, and a service worker
      previously registered by an older installation must not survive as a stale controller.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (No new dependency)**: No `next-pwa`, `workbox` or equivalent package is added. A
      policy of "pass everything through, keep one fallback document" does not justify a build-time
      caching framework (Constitution, Article X).
- [ ] **NFR-2 (The upload route is untouched)**: The resumable tus route (`POST/PATCH/HEAD /uploads`
      on `api`, the project's one REST exception) and any streaming response must behave identically
      with the service worker installed — no interception, no body buffering, no retry.
- [ ] **NFR-3 (Routing-mode agnostic)**: The manifest and the registration must work both behind
      Traefik with a domain and in port mode, which means no host, scheme or port is baked into the
      manifest or the worker; `start_url` and `scope` are root-relative.
- [ ] **NFR-4 (Offline copy staleness is bounded)**: The offline document is the one cached
      resource, so its text is as old as the last time it was stored. It must be refreshed in the
      background on a successful navigation, so a locale change or a copy change reaches it on the
      next visit rather than never. A user who switches `uiLocale` and immediately goes offline may
      see the previous language once; that is accepted and must be written down where the worker
      lives.
- [ ] **NFR-5 (No telemetry, no external fetch)**: Nothing this feature adds may contact a host
      outside the LAN. The installation has no route to the internet; a manifest icon, font or
      script fetched from a CDN would simply fail.

## GraphQL Contract Delta

**None — this feature does not cross the service boundary.** REQ-6 is rendered from
`EnvironmentInfo.useHttps`, which `api` already exposes and `web` already reads
(`services/web/src/actions/environment.ts`, `components/settings/EnvironmentPanel.tsx`, added by
`066-https-local-ca`); whether the browser will install the app is decided client-side from the
secure-context check, not by a new server field.

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1**: With `USE_TRAEFIK=true` and `USE_HTTPS=true`, on a device that trusts `certs/ca.crt`,
      Chrome's DevTools → Application → Manifest reports no installability error and the browser
      offers "Install Perceptor"; installing it opens a standalone window with the Perceptor icon
      and no address bar.
- [ ] **AC-2**: In that same window, DevTools → Application → Service Workers shows exactly one
      activated worker, scope `/`.
- [ ] **AC-3** (failure path — no secure context): Reaching the same stack at
      `http://<lan-ip>:${WEB_PORT}`, every screen renders and behaves exactly as before, DevTools →
      Application → Service Workers lists none, and the Console shows no error or warning from the
      registration attempt.
- [ ] **AC-4** (failure path — server down): With the app installed and open, `docker compose stop
      web api`, then navigate to another screen: the Perceptor offline screen appears with its retry
      control, in the UI locale in effect. `docker compose start web api`, press retry, and the
      originally requested screen loads.
- [ ] **AC-5** (failure path — sub-resource): With the stack down, a `fetch` of the GraphQL endpoint
      from the installed app's console rejects with a network error; it does not resolve with the
      offline document.
- [ ] **AC-6** (the staleness guarantee): With the app installed and open, change a visible string in
      `services/web/messages/en.json`, rebuild and restart `web`, then reload the installed window —
      the new string appears on that first reload. DevTools → Application → Cache Storage holds at
      most the offline document and no build asset.
- [ ] **AC-7**: Uploading a multi-gigabyte file through the import modal from the installed app
      completes, and DevTools → Network shows the `PATCH /uploads` requests going to the network
      with no `(ServiceWorker)` in their size column.
- [ ] **AC-8**: On iOS Safari, *Add to Home Screen* produces a Perceptor icon that launches without
      Safari's chrome.
**Verification status as of 2026-10-09.** AC-1 to AC-8 need a browser this session does not have.
The attempt and what it established, so the next pass does not repeat it:

- The registration gate is `window.isSecureContext` (`components/pwa/ServiceWorkerRegistration.tsx`),
  **not** `USE_HTTPS`. Since `http://localhost` is a secure context in Chromium, these criteria do
  not actually require HTTPS or a trusted `certs/ca.crt` — `http://localhost:3000` is enough — and
  `ServiceWorkerRegistration` is mounted in the root `src/app/layout.tsx`, so it runs on the login
  page too and no session is needed either. That makes AC-1, AC-2, AC-4, AC-5 and AC-6 cheaper than
  the criteria imply.
- Registration nonetheless failed in the available browser with
  `TypeError: Failed to register a ServiceWorker … An unknown error occurred when fetching the
  script`, while `GET /sw.js` itself answered `200` with `application/javascript; charset=UTF-8` and
  the correct body. **This is the environment, not Perceptor**: a control origin — a one-line
  `self.addEventListener("install", …)` served by `python -m http.server` on `127.0.0.1:8099`, with
  `isSecureContext` true and `'serviceWorker' in navigator` true — failed with the identical error.
  The browser in use does not permit service worker registration at all.
- AC-3 is therefore not merely unrun but **unrunnable** in that browser: with registration blocked
  everywhere, an absent worker at a non-secure origin cannot be distinguished from the gate working.
  It needs a browser where the localhost case registers, so that the LAN-IP case failing to register
  means something.
- **AC-8 needs a physical iOS device**, following the `079` AC-6 precedent — no structural substitute.

What this leaves: run AC-1 through AC-7 and AC-9 in a real browser against `http://localhost:3000`
(or the HTTPS domain if the installability prompt itself is in question, which only AC-1 needs), and
AC-8 on an iPhone. AC-6's rebuild step is the one to adapt: the root `CLAUDE.md` forbids
`bin/npm web run build` against a live dev stack, and in dev mode a changed catalog string hot-reloads
anyway, so verify the staleness guarantee by the Cache Storage contents (at most the offline document,
no build asset) rather than by a production rebuild.

- [ ] **AC-9**: Settings → Environment shows an installability row: with `USE_HTTPS=true` it reads as
      available; with HTTPS off it reads as unavailable and names HTTPS as the reason, beside the
      existing badge. `bin/cli web node scripts/check-messages.mjs` reports no `en`/`es` drift.
- [x] **AC-10**: `git diff --stat services/api services/worker` is empty and `services/api/src/schema.gql`
      is unchanged. Confirmed 2026-10-09 against the feature's own commit (`ae6c23b`, "add &
      implement 080 spec, pwa"), whose entire diff is `CLAUDE.md`, this feature's `tasks.md`,
      `services/web/CLAUDE.md`, `services/web/public/sw.js` and `services/web/src/app/globals.css`
      — no file under `services/api/` or `services/worker/`, so no `schema.gql` delta either.
      Worth recording while reading that commit: `manifest.json` was added earlier by `689c65e`
      ("favicon") and `sw.js`, `offline/page.tsx` and `ServiceWorkerRegistration.tsx` by `94aee98`
      ("implement 079 spec, mobile"), so most of this feature's code landed inside `079`'s commit
      and `080`'s own commit only adjusted `sw.js`. That is why `spec.md` still reads
      `status: Approved` — the `/implement` run was folded into its predecessor's.

## Out of Scope

- **Push notifications of any kind.** Web Push requires a browser vendor's push service on the
  public internet; an installation with no route out cannot subscribe. A download finishing or an
  encode completing will not notify a closed app. Revisiting this means a foreground-only
  `Notification` raised by an open tab, which is a different feature.
- **Offline data.** No GraphQL response, poster, library listing or download queue is cached. Offline
  means "the offline screen", never "a stale library".
- **Precaching build assets.** Explicitly rejected by REQ-3: it is the mechanism by which a
  self-hosted app shows an old interface after an image update.
- **An in-app install button.** No `beforeinstallprompt` capture, no custom install card; the
  browser's own affordance is the entry point. Settings only states whether that affordance can
  appear.
- **Background sync, periodic sync, badging, share target, file handlers, protocol handlers,
  window controls overlay.** None of them have a use here today.
- **Icon and splash-screen redesign.** The two existing PNGs are reused; if a non-maskable variant
  is needed it is derived from them, not drawn anew.
- **Mobile layout work.** That is `079-mobile-legibility-pass`; this feature changes no component's
  layout.
