---
title: TMDB key onboarding on the home page
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-09-25
last_updated: 2026-09-25
status: Approved
services: [api, web]
---

# SPEC: TMDB key onboarding on the home page (`spec.md`)

## Context & Goal

A fresh install ships `movie_db_api_key` empty (root `CLAUDE.md` → Environment). The first thing a
new user sees on `/` (`services/web/src/app/(dashboard)/page.tsx`, the billboard) is therefore an
error: `popularMedia` fails, `api`'s `PopularMediaService` maps every TMDB failure to
`error.media.catalog_unavailable` ("Could not query the catalog. Check the TMDB API key."), and the
carousel renders that string. It tells the user something is broken without telling them why
Perceptor needs a key of its own, or how to get one.

Bringing your own key is a deliberate privacy choice, not an installation chore: Perceptor has no
central server and no shared key, so every catalog request goes from the user's own installation to
TMDB under the user's own account, and nothing about what they search or register passes through,
or is kept by, the Perceptor project in any form. This feature replaces the error on the home page
with a short explanation of that reason, followed by the simplest possible step-by-step guide to
obtaining a TMDB key, with working links.

Today `web` cannot tell "no key", "rejected key" and "TMDB is down" apart — all three arrive as the
same error key. `api` must expose the difference. Pipeline stage touched: **Search catalog (TMDB)**,
read side only (the billboard); nothing downstream changes.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Key state exposed)**: `api` must let any authenticated user learn, without reading the
      key itself, whether a TMDB key is configured.
- [ ] **REQ-2 (Rejected key distinguished)**: When TMDB rejects the configured key (HTTP 401),
      `popularMedia` must fail with a distinct error key, not `error.media.catalog_unavailable`.
      Any other TMDB failure keeps `error.media.catalog_unavailable` unchanged.
- [ ] **REQ-3 (Onboarding replaces the error)**: On `/`, when no key is configured, `web` must show
      the onboarding panel instead of the billboard error, and must not call `popularMedia` at all.
- [ ] **REQ-4 (Rejected-key variant)**: On `/`, when `popularMedia` fails with the REQ-2 key, `web`
      must show the same onboarding panel preceded by a notice that the configured key does not
      work and must be replaced.
- [ ] **REQ-5 (Why first)**: The panel must open with the reason before any step: Perceptor has no
      central server or shared key; with your own key, catalog requests go straight from your
      installation to TMDB and Perceptor keeps no data about you in any way.
- [ ] **REQ-6 (Steps)**: The panel must then list, in order, the minimum steps, each with a link
      where one applies:
      1. Create a free TMDB account — https://www.themoviedb.org/signup
      2. Confirm the e-mail TMDB sends, then sign in — https://www.themoviedb.org/login
      3. Open the API page and request a key (type "Developer", personal/non-commercial use,
         accept the terms — https://www.themoviedb.org/api-terms-of-use) —
         https://www.themoviedb.org/settings/api
      4. Copy the **API Read Access Token** (the long token, not the short "API Key") from that same
         page.
      5. Paste it in Perceptor → Settings, TMDB API key field, and save.
- [ ] **REQ-7 (Admin-only completion)**: Every user sees the whole panel (reason and steps). The
      panel must state plainly that only an administrator can complete the last step. For an admin,
      step 5 links to the Settings screen; for a non-admin it reads as "ask an administrator" with
      no link to a screen they cannot open.
- [ ] **REQ-8 (Recovery)**: Once a valid key is saved, reloading `/` shows the normal billboard with
      no leftover panel.
- [ ] **REQ-9 (Translated)**: All panel copy lives in `messages/{en,es}.json` (`es` in the existing
      Rioplatense register); links are not translated.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (No secret leaks)**: The key value never crosses GraphQL to a non-admin, not even
      partially; REQ-1 exposes a boolean-like state only.
- [ ] **NFR-2 (No extra TMDB calls)**: Determining "no key" must not call TMDB. Detecting a
      rejected key reuses the `popularMedia` call the page already makes (Deployment scale: conserve
      external API calls).
- [ ] **NFR-3 (Scope of change)**: `searchMedia`/`addMedia` error behaviour is unchanged; only the
      home page gets the onboarding panel.

## GraphQL Contract Delta

```graphql
type MediaCapabilities {
  moviesEnabled: Boolean!
  showsEnabled: Boolean!
  shortsEnabled: Boolean!
  catalogKeyConfigured: Boolean!   # new: movie_db_api_key is non-empty (trimmed)
}
```

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| `popularMedia`, key configured but TMDB answers 401 | `ServiceUnavailableException`, `extensions.i18n.key = error.media.catalog_unauthorized` | en: "TMDB rejected the configured API key." / es: "TMDB rechazó la clave de API configurada." — `web` shows the REQ-4 panel instead of this bare string |
| `popularMedia`, any other TMDB failure | unchanged: `error.media.catalog_unavailable` | unchanged — `web` keeps today's error rendering |
| `popularMedia` called with no key configured | behaves as today (TMDB 401 → now `error.media.catalog_unauthorized`) | `web` never makes this call (REQ-3) |

`web` consumer obligations: read `catalogKeyConfigured` from the existing `getMediaCapabilities`
call; branch on `error.media.catalog_unauthorized` to render the REQ-4 variant.

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1**: Given `movie_db_api_key` empty, an admin opening `/` sees the privacy reason first,
      then the five steps with working links, step 5 linking to Settings; no catalog error text
      appears, and the api logs show no TMDB request for that page load.
- [ ] **AC-2**: Given the same state, a non-admin opening `/` sees the same reason and steps, with a
      clear note that only an administrator can finish, and no link to Settings.
- [ ] **AC-3 (failure)**: Given `movie_db_api_key` set to `garbage`, opening `/` shows the "your key
      does not work" notice followed by the onboarding panel.
- [ ] **AC-4 (failure)**: Given a valid key but TMDB unreachable (e.g. network cut from the `api`
      container), `/` shows today's `catalog_unavailable` error, not the onboarding panel.
- [ ] **AC-5**: After an admin saves a valid key in Settings, reloading `/` shows the popular
      carousels.
- [ ] **AC-6**: Every link in the panel opens the expected TMDB page (signup, login, API settings,
      API terms) — checked by hand on the day the spec is approved.
- [ ] **AC-7**: A non-admin's `mediaCapabilities` response contains `catalogKeyConfigured` and
      nothing derived from the key's value; `bin/cli web node scripts/check-messages.mjs` reports no
      `en`/`es` drift.

## Out of Scope

- **`/search` and the header search box.** They keep their current error; the home page is the
  entry point a new user lands on. Extending the panel there is a later, one-service change.
- **Validating the key when it is saved in Settings.** Would need a TMDB call on save; separate idea.
- **Screenshots of TMDB's UI.** They go stale whenever TMDB redesigns; text steps with links only.
- **Changing how the key is stored or bundling a shared key.** A shared key is exactly what this
  feature argues against.
