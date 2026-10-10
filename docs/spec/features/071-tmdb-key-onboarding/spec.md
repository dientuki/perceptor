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

**Verification status — 2026-10-09** (pass over 002–071 on `fix/tech-debt`, no code change)

AC-7 is closed above. The two still open are blocked twice over, and the second reason is the
harder one: this installation **has a TMDB key configured** (`movie_db_api_key`, non-empty), so the
onboarding panel does not render here at all. Verifying AC-2 or AC-6's rendered output means first
clearing that key — an admin Settings write that would break catalog search for the installation
until restored — and then signing in, as a **non-admin** for AC-2, where the user table holds
exactly one row (the seeded admin). So: a second user, a session, and a deliberately broken key.

- **AC-6** — the link *targets* are verified, only the render is not. The panel hard-codes four
  URLs (`web/src/components/onboarding/TmdbKeyOnboarding.tsx:4-7`); fetched 2026-10-09,
  `https://www.themoviedb.org/signup`, `/login` and `/api-terms-of-use` each answer `200` with no
  redirect, and `/settings/api` answers `401` — which is the expected page, reachable only after the
  TMDB login the panel's own steps tell the user to do first.
- **AC-2** — needs the non-admin session described above. Note that the *data* half cannot differ:
  `mediaCapabilities` takes no principal (see AC-7), so an admin and a non-admin are served the
  identical capability object; what AC-2 actually tests is `web`'s rendering of it minus the
  admin-only Settings shortcut.

- [x] **AC-1**: Given `movie_db_api_key` empty, an admin opening `/` sees the privacy reason first,
      then the five steps with working links, step 5 linking to Settings; no catalog error text
      appears, and the api logs show no TMDB request for that page load.
- [ ] **AC-2**: Given the same state, a non-admin opening `/` sees the same reason and steps, with a
      clear note that only an administrator can finish, and no link to Settings.
      **Still open 2026-10-09, and the key is no longer what blocks it.** Emptying
      `movie_db_api_key` is safe and reversible (done twice this pass, via a scratch table, with the
      key never read), and the panel renders. What is missing is the subject: the criterion is about
      a **non-admin's** view of that panel - the same reason and steps, the "only an administrator
      can finish" note, and no Settings link - and the `users` table holds one row, an admin. The
      admin's view of the same panel does carry both the note
      ("Only an administrator can complete the last step.") and the Settings link, measured on
      `/first-step`, which repeats this block.

- [x] **AC-3 (failure)**: Given `movie_db_api_key` set to `garbage`, opening `/` shows the "your key
      does not work" notice followed by the onboarding panel.
- [x] **AC-4 (failure)**: Given a valid key but TMDB unreachable (e.g. network cut from the `api`
      container), `/` shows today's `catalog_unavailable` error, not the onboarding panel.
- [x] **AC-5**: After an admin saves a valid key in Settings, reloading `/` shows the popular
      carousels.
- [x] **AC-6**: Every link in the panel opens the expected TMDB page (signup, login, API settings,
      API terms) — checked by hand on the day the spec is approved.
      **Confirmed 2026-10-09.** With `movie_db_api_key` emptied (saved to a scratch table and
      restored immediately, never read), `/` rendered the onboarding panel instead of the
      carousels, and its four links are
      `https://www.themoviedb.org/signup`, `https://www.themoviedb.org/login`,
      `https://www.themoviedb.org/settings/api` and
      `https://www.themoviedb.org/api-terms-of-use`. Fetched: signup, login and the terms answer
      `200`; the API settings page answers `401`, which is TMDB's own sign-in gate on a page that
      requires an account - the step before it in the panel is "Confirm the e-mail TMDB sends you,
      then sign in" - not a broken link.

- [x] **AC-7**: A non-admin's `mediaCapabilities` response contains `catalogKeyConfigured` and
      nothing derived from the key's value; `bin/cli web node scripts/check-messages.mjs` reports no
      `en`/`es` drift.
      **Verified 2026-10-09** (branch `fix/tech-debt`, commit `b65ef65`). The criterion is a property
      of the response shape, and the resolver has no non-admin variant to run: `mediaCapabilities`
      (`media/media.resolver.ts:22`) takes no principal at all — no `@CurrentUser`, no role guard
      beyond the global auth, no branch — so every authenticated caller receives the identical
      object. That object is four booleans (`media-capabilities.entity.ts`, `schema.gql:431`), and
      `catalogKeyConfigured` is computed as `(map['movie_db_api_key'] ?? '').trim() !== ''`
      (`media-capabilities.service.ts:21`) — a pure emptiness test, so nothing derived from the key's
      value can reach the response. `media-capabilities.service.spec.ts` § `catalogKeyConfigured`
      parametrises it. `bin/cli web node scripts/check-messages.mjs` reports `en.json` and `es.json`
      matching exactly (602 keys).

## Out of Scope

- **`/search` and the header search box.** They keep their current error; the home page is the
  entry point a new user lands on. Extending the panel there is a later, one-service change.
- **Validating the key when it is saved in Settings.** Would need a TMDB call on save; separate idea.
- **Screenshots of TMDB's UI.** They go stale whenever TMDB redesigns; text steps with links only.
- **Changing how the key is stored or bundling a shared key.** A shared key is exactly what this
  feature argues against.
