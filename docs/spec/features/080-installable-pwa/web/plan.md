---
title: Installable PWA (LAN-scoped) — web slice
service: web
last_updated: 2026-09-28
status: Approved
---

# PLAN: Installable PWA (LAN-scoped) — `web` (`web/plan.md`)

## Scope

`web` owns the whole feature. It completes the manifest, adds a service worker and its registration,
adds the offline route, exempts the three new public paths from `proxy.ts`, and adds the
installability row to the Settings → Environment tab.

It does **not** touch `api` or `worker` (no GraphQL delta exists — `../spec.md` § GraphQL Contract
Delta is `None`), does not touch `docker-compose*.yaml`, `.env.example` or `install.sh`, and adds no
npm dependency. Writes are confined to `services/web/` and this directory; anything else is a
stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/src/proxy.ts` | Modified | `PUBLIC_ROUTES` gains `/sw.js`, `/manifest.json`, `/offline` |
| `services/web/src/app/manifest.json` | Modified | `id`, `start_url`, `scope`, `description`, `lang`, `orientation`, `any`-purpose icons, palette colours |
| `services/web/src/app/layout.tsx` | Modified | `metadata`/`viewport` exports replace the two hand-written `<head>` metas; mounts the registration component |
| `services/web/public/sw.js` | New | The service worker: pass-through, offline navigation fallback, versioned cache |
| `services/web/src/components/pwa/ServiceWorkerRegistration.tsx` | New | `"use client"`, registers `/sw.js` in a secure context only; renders nothing |
| `services/web/src/app/offline/page.tsx` | New | The cached offline document — inline styles, no-JS retry |
| `services/web/src/components/settings/EnvironmentPanel.tsx` | Modified | One installability row beside the HTTPS badge |
| `services/web/messages/en.json`, `messages/es.json` | Modified | `offline.*` and `settings.environment.pwa*` keys |
| `services/web/CLAUDE.md` | Modified | The cache policy and the NFR-4 staleness bound |

## Existing code to reuse

- `src/proxy.ts` — `PUBLIC_ROUTES` is the existing exemption list (it already carries `/ca.crt`,
  the closest precedent: a root-level asset that must answer without a session). Match it exactly;
  note the check is `pathname === route`, not `startsWith`, so each path is listed literally.
- `src/app/layout.tsx` — the root layout already resolves the locale and wraps the tree in
  `NextIntlClientProvider` → `ThemeProvider` → `SidebarProvider`. The registration component mounts
  inside `<body>` alongside them; do not create a second provider layer for it.
- Next's file-based icons already in `src/app/` (`icon0.svg`, `icon1.png`, `apple-icon.png`) — the
  `<link rel="icon">`/`apple-touch-icon` tags are generated from these. Do not hand-write them, and
  do not add new icon files: the manifest's `any`-purpose entries point at the two existing PNGs in
  `public/`.
- `src/components/settings/EnvironmentPanel.tsx` — already `"use client"`, already renders
  `Label` + `Badge` rows and the `/ca.crt` link. The new row is one more block in that same file,
  using the same `Badge` colours (`success`/`light`) and the same `useTranslations("settings.environment")`
  namespace. No new panel, no new tab, and nothing that writes.
- `src/lib/request-scheme.ts` — read it before reaching for it: it detects the *request's* scheme
  server-side for the cookie and upload endpoint. It is **not** the right input for REQ-6, which is
  about the browser's secure context; use `window.isSecureContext` client-side instead.
- The `messages/{en,es}.json` catalogs and `scripts/check-messages.mjs` — every string is
  catalog-driven, `es` in the existing Rioplatense register.

## Steps

1. **`proxy.ts` first.** Add `"/sw.js"`, `"/manifest.json"` and `"/offline"` to `PUBLIC_ROUTES`.
   Without this, all of the following is unobservable: each path answers `307 → /login` to a request
   with no cookie, and a manifest is fetched uncredentialed by default, so installability breaks for
   signed-in users too.
2. **`src/app/offline/page.tsx`.** A Server Component, no dashboard layout, no data fetch, no
   `getCurrentUser`. Renders the wordmark or app name, a heading and a sentence saying the server is
   unreachable, and a retry control. Two hard constraints: all of its styling is an inline `<style>`
   element in the page (the Tailwind chunk cannot be fetched at the moment this document is shown),
   and the retry is `<a href="">` — an empty href resolves to the current URL, which is the
   navigation that failed, so it works with no JavaScript. Text comes from a new `offline` namespace
   in both catalogs. Honour light and dark with a `prefers-color-scheme` block inside that inline
   style: the `.dark` class comes from `ThemeProvider`, whose JS will not be running.
3. **`public/sw.js`.** No build step, no import, no comment (Article XI). Shape:
   - a module-level cache name carrying a version string, e.g. `perceptor-offline-v1`;
   - `install`: open that cache, `add('/offline')`, then `skipWaiting()`;
   - `activate`: delete every cache whose name is not the current one, then `clients.claim()`;
   - `fetch`: return immediately (no `respondWith`) unless `event.request.mode === "navigate"`; for
     a navigation, `respondWith(fetch(request).catch(() => caches.match('/offline')))`, and on the
     success path opportunistically refresh the cached `/offline` once per worker lifetime (NFR-4).
     Nothing else is ever stored, and no response for a script, stylesheet, image, font or `/graphql`
     or `/uploads` request is ever served from the cache.
4. **`ServiceWorkerRegistration.tsx`.** `"use client"`, returns `null`, registers in a `useEffect`
   guarded by `typeof window !== "undefined" && window.isSecureContext && "serviceWorker" in
   navigator`, with `navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })`
   and a `.catch()` that swallows rather than logs — REQ-5/AC-3 want a clean console outside a secure
   context. Mount it in `layout.tsx`.
5. **`manifest.json`.** Add `id: "/"`, `start_url: "/"`, `scope: "/"`, `lang`, `description`,
   `orientation: "any"`, and a second pair of icon entries pointing at the same two PNGs with
   `purpose: "any"`. Replace the two `#ffffff` colours: `background_color` stays `#ffffff` (the
   light theme is the default in `ThemeContext`, so the splash matches what opens) and `theme_color`
   becomes `#465fff`, the `--color-brand-500` token from `globals.css`. Everything is root-relative —
   no host, scheme or port (NFR-3).
6. **`layout.tsx` metadata.** Export `metadata` with `applicationName: "Perceptor"` and
   `appleWebApp: { capable: true, title: "Perceptor", statusBarStyle: "black-translucent" }`, and
   `viewport` with a light/dark `themeColor` pair (`#ffffff` / `#101828`, the `--color-gray-900`
   token). Delete the now-duplicated hand-written `<head>` metas — one way to do it, not two.
7. **`EnvironmentPanel.tsx`.** Add an installability row after the HTTPS row: a `useState<boolean |
   null>(null)` set in a `useEffect` from `window.isSecureContext && "serviceWorker" in navigator`
   (null until mounted, so the server and client markup agree), rendered as
   `Badge success` when true and `Badge light` plus a sentence naming HTTPS as the reason when
   false. Add the keys to both catalogs.
8. **`services/web/CLAUDE.md`.** A short section stating the policy so the next feature does not
   quietly add a precache: the worker caches exactly one document; its copy is refreshed on activate
   and once per worker lifetime after a successful navigation, so a locale switch immediately
   followed by going offline can show the previous language once.

## Contract obligations

None. `../spec.md` § GraphQL Contract Delta is **None — this feature does not cross the service
boundary.** No query, mutation, field or error key is added, consumed differently, or removed.
`EnvironmentInfo.useHttps` is already typed in `src/types/environment.ts` and already fetched by
`src/actions/environment.ts`; this slice adds no GraphQL document and must not edit either file.

If an implementer concludes a server field is needed, stop and report — do not add one.

## Tests

`services/web` has no test runner (see `services/web/CLAUDE.md`), so nothing here is owed a
`.spec.ts`. The two failures in this slice that are genuinely silent are both guarded by an
acceptance criterion instead, and that is the whole reason those criteria are written the way they
are:

- the `proxy.ts` redirect (no error anywhere, installation just never offered) → AC-1 and AC-2;
- a cache entry that should not exist (invisible until an image update serves a stale UI) → AC-6.

`scripts/check-messages.mjs` covers catalog drift, as on every other `web` feature.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/cli web node scripts/check-messages.mjs
bin/npm web run lint
```

Typecheck at 0 errors, no `en`/`es` drift, and `git diff --stat services/api services/worker` empty.
Then the manual pass in `../plan.md` § Verification.
