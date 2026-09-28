---
title: Installable PWA (LAN-scoped) — Tasks
last_updated: 2026-09-28
status: In Progress
---

# TASKS: Installable PWA (LAN-scoped) (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

This feature is `web` only. There is no GraphQL delta, no migration and no compose change, so there
is no `api`, `worker` or `infra` task — an agent that finds itself outside `services/web/` and this
feature's own directory has taken a wrong turn and must stop and report.

## Tasks

### Group 1 — the gate

Nothing downstream is observable until this lands: `/sw.js`, `/manifest.json` and `/offline` are all
matched by `proxy.ts` and none is public, so each answers `307 → /login` without a cookie, and a
manifest is fetched uncredentialed by default.

- [x] **T001** `[web]` Add `"/sw.js"`, `"/manifest.json"` and `"/offline"` to `PUBLIC_ROUTES` in
      `services/web/src/proxy.ts`. The check is `pathname === route`, so list each literally.
      *Done when:* with the dev stack up and no session cookie,
      `curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:${WEB_PORT}/manifest.json` prints
      `200`, and the same for `/sw.js` (`404` is acceptable for `/sw.js` before T003, never `307`).

### Group 2 — the offline document and the worker

One chain: the worker precaches the document, so the document exists first.

- [x] **T002** `[web]` Add `services/web/src/app/offline/page.tsx` — a Server Component with no data
      fetch and no `getCurrentUser`, rendering the app name, a heading, a sentence saying the server
      is unreachable and a retry control. All styling is an inline `<style>` element in the page,
      including a `prefers-color-scheme` dark block; the retry is `<a href="">`. Both constraints
      are load-bearing (`../plan.md` § Contract Freeze): this document renders when no stylesheet and
      no script can be fetched. Text comes from a new `offline` namespace in
      `messages/en.json`/`messages/es.json`, `es` in the existing Rioplatense register.
      *Done when:* `/offline` renders in a browser with styling and a working retry, and
      `bin/cli web node scripts/check-messages.mjs` reports no drift. → T001
- [x] **T003** `[web]` Add `services/web/public/sw.js`: a versioned cache name; `install` opens it,
      adds `/offline`, then `skipWaiting()`; `activate` deletes every other cache then
      `clients.claim()`; `fetch` returns without calling `respondWith` for anything whose
      `request.mode !== "navigate"`, and for a navigation answers
      `fetch(request).catch(() => caches.match("/offline"))`, refreshing the cached `/offline` once
      per worker lifetime on the success path. Nothing else is ever stored. No comments (Article XI),
      no build step, no dependency.
      *Done when:* after a reload over HTTPS, DevTools → Application → Service Workers shows one
      activated worker at scope `/`, and Cache Storage holds exactly one entry, `/offline`. → T002
- [x] **T004** `[web]` Add `services/web/src/components/pwa/ServiceWorkerRegistration.tsx`
      (`"use client"`, renders `null`) registering `/sw.js` with `{ scope: "/", updateViaCache: "none" }`
      in a `useEffect` guarded by `window.isSecureContext && "serviceWorker" in navigator`, with a
      `.catch()` that swallows rather than logs; mount it inside `<body>` in
      `services/web/src/app/layout.tsx` beside the existing providers.
      *Done when:* over HTTPS the worker registers; over `http://<lan-ip>:${WEB_PORT}` no worker is
      registered and the console shows no error or warning (AC-3). → T003

### Group 3 — packaging

T005 is independent of Group 2. T006 edits `layout.tsx`, which T004 also touches, so it follows it
rather than racing it.

- [x] **T005** `[web] [P]` Extend `services/web/src/app/manifest.json`: `id`, `start_url` and `scope`
      all `/`, plus `lang`, `description`, `orientation`, a second pair of icon entries pointing at
      the two existing PNGs in `public/` with `purpose: "any"`, `theme_color: "#465fff"`
      (`--color-brand-500`) and `background_color: "#ffffff"`. Root-relative throughout — no host,
      scheme or port.
      *Done when:* DevTools → Application → Manifest lists every field and reports no installability
      error over HTTPS. → T001
- [ ] **T006** `[web]` Replace the two hand-written `<head>` metas in
      `services/web/src/app/layout.tsx` with Next's `metadata` export (`applicationName`,
      `appleWebApp: { capable, title, statusBarStyle }`) and a `viewport` export carrying the
      light/dark `themeColor` pair (`#ffffff` / `#101828`). Do not hand-write icon links — Next
      generates them from `src/app/icon0.svg`, `icon1.png` and `apple-icon.png`.
      *Done when:* the rendered page's `<head>` carries `application-name`,
      `apple-mobile-web-app-capable`, `apple-mobile-web-app-title`, `apple-mobile-web-app-status-bar-style`
      and both `theme-color` entries, with no duplicates. → T004, T005
- [ ] **T007** `[web] [P]` Add the installability row to
      `services/web/src/components/settings/EnvironmentPanel.tsx`, after the HTTPS row: a
      `useState<boolean | null>(null)` set in a `useEffect` from
      `window.isSecureContext && "serviceWorker" in navigator`, rendered with the existing `Badge`
      (`success` when true, `light` plus a sentence naming HTTPS as the reason when false), using the
      existing `settings.environment` namespace. Add the keys to both catalogs. No new panel, no
      write path, no GraphQL document — `EnvironmentInfo.useHttps` is already fetched.
      *Done when:* Settings → Environment shows the row as available over HTTPS and as unavailable,
      naming HTTPS, over plain HTTP (AC-9); `check-messages` reports no drift. → T001

### Group 4 — verification and docs

- [ ] **T008** `[web]` Run the slice's checks and fix anything they surface.
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports 0 errors,
      `bin/cli web node scripts/check-messages.mjs` reports no `en`/`es` drift,
      `bin/npm web run lint` is no worse than it was before this feature (Biome already fails on
      pre-existing formatting in this service — compare, do not reformat unrelated files), and
      `git diff --stat services/api services/worker` is empty. → T004, T006, T007
- [ ] **T009** `[docs]` Add the cache policy to `services/web/CLAUDE.md`: the worker caches exactly
      one document, `/offline`; nothing else is ever stored, and a precache of build assets is
      forbidden because it is how an updated image serves yesterday's interface. Record the NFR-4
      staleness bound there too (refreshed on activate and once per worker lifetime after a
      successful navigation, so a locale switch immediately followed by going offline can show the
      previous language once) — Article XI forbids it as a code comment. Add the measured line to the
      root `CLAUDE.md` § Current state; the pipeline table is **not** touched, since no stage changed.
      *Done when:* both files describe the shipped behaviour and name `080-installable-pwa`. → T008
- [ ] **T010** `[docs]` Walk the acceptance criteria in `spec.md` against a running stack with
      `USE_TRAEFIK=true` and `USE_HTTPS=true` from a device that trusts `certs/ca.crt`, following
      `../plan.md` § Verification. Tick each box that passes; record any criterion that could not be
      run as **unverified**, never as passed (AC-8 needs a physical iOS device — the `079` precedent
      is to say so explicitly). Then set `status: Implemented` on `spec.md`, `plan.md` and
      `web/plan.md`, and `status: Done` here. → T009

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |
