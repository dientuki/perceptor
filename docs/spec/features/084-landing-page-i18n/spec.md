---
title: Landing Page Internationalization
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-10-02
last_updated: 2026-10-03
status: Implemented
services: []             # none — this feature lives entirely outside services/
---

# SPEC: Landing Page Internationalization (`spec.md`)

## Context & Goal

The public landing page is one hand-written static file, `site/index.html` (645 lines), published to
GitHub Pages by `.github/workflows/pages.yml`, which uploads the `site/` directory as-is with no
build step. It is entirely in English — nav, hero, six sections, the FAQ, the footer, every `alt`
and `figcaption`, and the whole `<head>`. The application behind it has spoken two languages since
`018-ui-i18n`, and its author writes in Rioplatense Spanish, so the one surface that introduces the
project to a stranger is also the only one that cannot meet a Spanish speaker in their language.

This feature makes that page bilingual the way a static site can actually be bilingual: two real
URLs, each a complete document. The root stays English and `/es/` is added, because the language
has to live in the URL rather than in a client-side string swap — the preview crawlers of WhatsApp,
Twitter, Discord and Slack do not execute JavaScript, so a page that translates itself after load
would still hand every one of them an English `<title>` and English `og:` tags no matter what the
visitor's browser says. English is the root because the root is the URL that collects the backlinks
and sits in the repository's About field, the audience that discovers self-hosted media tooling is
overwhelmingly anglophone, and the rest of the repository is English by Article VI anyway. A
visitor whose browser prefers Spanish is sent from `/` to `/es/` by a small script, and a visitor
who picks a language by hand keeps it.

To avoid maintaining the same 645 lines twice — which is how one locale silently rots — the markup
becomes a single template plus one string catalog per locale, living in a new top-level `tools/`
directory, outside `site/` so that nothing but the published page is ever published. The two
`index.html` files are generated from it and committed.

**No pipeline stage in the root `CLAUDE.md` changes.** No service is touched: `services:` is
deliberately empty, so `/plan-feature` creates no `<svc>/plan.md`. Article VII does not require a
spec for this work at all — it touches no `services/*` directory, no Prisma schema, no GraphQL
contract and no pipeline stage. This spec exists for the same reason `079-mobile-legibility-pass`
does: to pin down verifiable criteria for a presentational change whose failure modes are quiet.
Article VI's "everything committed is English" rule is not violated either — the exception it
carves out is user-facing copy, and this page is nothing but user-facing copy.

## Requirements

### Functional Requirements

- [x] **REQ-1 (Two complete pages)**: Must publish two documents — `/` in English and `/es/` in
      Spanish — each one a complete, self-contained landing page whose every section is present and
      rendered in its own language in the delivered HTML, before any script runs.
- [x] **REQ-2 (One source of markup)**: Must derive both documents from a single markup source and
      one string catalog per locale, held outside the published directory. Correcting a sentence in
      one language must not require touching markup, and adding a section must not require writing
      it twice.
- [x] **REQ-3 (Localized head)**: Each document must carry its own `<html lang>`, `<title>`,
      `meta description`, `og:title`, `og:description`, `og:locale`, `og:url`, `twitter:*` text and
      `<link rel="canonical">` pointing at itself.
- [x] **REQ-4 (Reciprocal hreflang)**: Both documents must declare `hreflang` alternates for `en`
      and `es`, plus `x-default` pointing at the root.
- [x] **REQ-5 (Language switcher)**: Both documents must offer a visible control in the header
      leading to the other language, which works as a plain link with JavaScript disabled.
- [x] **REQ-6 (Browser-language detection)**: A visitor arriving at `/` with no previously recorded
      choice, whose browser's first preferred language is a variant of Spanish (`es`, `es-AR`,
      `es-419`, `es-ES`, …), must be sent to `/es/`. `/es/` must never perform the symmetric
      sniffing — arriving there is already a statement of intent.
- [x] **REQ-7 (An explicit choice is sticky)**: Using the switcher, or arriving with an explicit
      language override, must record that choice and outrank the browser's preference on every
      later visit. The automatic redirect of REQ-6 must record nothing, so that a preference the
      visitor never expressed is never frozen.
- [x] **REQ-8 (Override is not a content URL)**: An explicit override must be expressed as a query
      parameter that redirects to the path URL of that locale and never serves content itself, so
      that no two URLs ever return the same document.
- [x] **REQ-9 (Verbatim set)**: The install command, `docker compose pull && up -d`, the example
      track titles (`English`, `日本語`, `한국어`), file sizes and release counts, resolution names,
      `perceptor.local`, the product name and every GitHub URL must appear identically in both
      documents.
- [x] **REQ-10 (Spanish register)**: The Spanish catalog must be Rioplatense — voseo, the same
      register as `services/web/messages/es.json` — not neutral Latin American Spanish.
- [x] **REQ-11 (Catalog parity check)**: A command must report any key present in one catalog and
      missing from the other, and exit non-zero when they drift, mirroring what
      `services/web/scripts/check-messages.mjs` does for the application.
- [x] **REQ-12 (Non-visible copy too)**: Every `alt`, `aria-label`, `figcaption` and the copy
      button's confirmation text must be translated, not only the prose a sighted visitor reads.

### Non-Functional & Operational Requirements

- [x] **NFR-1 (Content never depends on JavaScript)**: With scripting disabled, both documents must
      render completely and the switcher must still navigate. Only the automatic redirect and the
      clipboard button may degrade.
- [x] **NFR-2 (No new dependency, no new outbound contact)**: No i18n library, no font CDN, no
      third-party script. Generating the pages must need nothing beyond the Node already available,
      and opening either page must still contact nobody but GitHub — the privacy claim the page
      itself makes.
- [x] **NFR-3 (No flash of the wrong language)**: Detection must resolve before first paint, so a
      redirected visitor never sees English content, and must not add a history entry that traps
      the back button.
- [x] **NFR-4 (Assets are shared)**: `site/shots/`, `site/og.jpg`, `site/fonts/` and the two marks
      serve both locales unchanged. The feature must add no image and no font: the Inter latin
      subset already covers Spanish diacritics, and `og.jpg` carries no translatable text.
- [x] **NFR-5 (Both depths resolve)**: `/es/` sits one directory below the root, so every asset
      reference, in-page anchor and cross-locale link must resolve correctly from both depths.
- [x] **NFR-6 (Deployment is untouched)**: The generated documents are committed, and
      `.github/workflows/pages.yml` keeps working unchanged — the deploy stays "upload `site/`". A
      failure of the generator must break a working copy, never a deployment.
- [x] **NFR-7 (No service is touched)**: `git diff --stat services/` must be empty, with no Prisma
      migration and no change to `services/api/src/schema.gql`.
- [x] **NFR-8 (Redirects terminate)**: No sequence of stored preference, override and browser
      language may produce more than one hop or a loop between the two documents.
- [x] **NFR-9 (Degrades without storage)**: Storage being unavailable or throwing — private mode,
      blocked site data — must leave both documents fully working, falling back to browser
      detection, with nothing logged to the console.

## GraphQL Contract Delta

**None — this feature does not cross the service boundary.**

The landing page is static HTML published to GitHub Pages. It is not served by `web`, never reaches
`api`, and has no authenticated visitor, no mutation and no query. No error table applies because
there is no request: the only runtime failure modes are a visitor without JavaScript and a visitor
without storage, and both are specified as degradations in NFR-1 and NFR-9 rather than errors.

## Data Model Changes

**None.** No Prisma model, field, enum or migration. The database is not involved.

## Acceptance Criteria

- [x] **AC-1**: `grep -o '<html lang="[a-z]*"' site/index.html site/es/index.html` prints `en` for
      the first and `es` for the second.
- [x] **AC-2**: Opening `site/es/index.html` with JavaScript disabled shows the complete page —
      header, hero, the six sections, the FAQ, the closing block and the footer — in Spanish, with
      no English sentence in the body.
- [x] **AC-3**: `grep -c 'hreflang' site/index.html site/es/index.html` returns 3 for each, and
      each file's `x-default` alternate points at the root URL.
- [x] **AC-4**: In a browser configured with `es-AR` first and no stored preference, visiting `/`
      lands on `/es/` without the English page painting; in a browser configured `en-US`, visiting
      `/` stays on `/`.
- [x] **AC-5**: After the automatic redirect of AC-4, the stored preference is still empty — the
      visitor was moved but nothing was remembered.
- [x] **AC-6**: From `/es/`, clicking the switcher lands on `/`; reloading `/` afterwards stays in
      English even though the browser still prefers Spanish.
- [x] **AC-7** *(failure)*: Visiting `/?lang=fr` — a locale that does not exist — neither redirects
      anywhere nor records `fr`; the visitor gets the English page and the next visit is decided by
      browser language as if the parameter had not been there.
- [x] **AC-8** *(failure)*: With site data blocked so that storage access throws, both documents
      load completely, the switcher still navigates, detection still follows the browser language,
      and the console shows no error.
- [x] **AC-9** *(failure)*: With JavaScript disabled entirely, `/` renders the full English page and
      its switcher reaches `/es/` — neither document is blank and neither is a redirect shell.
- [x] **AC-10**: Loading `/es/` with the network panel open shows no 404 — the fonts, the mark, the
      seven screenshots and `og.jpg` all resolve from one directory deeper.
- [x] **AC-11** *(failure)*: Deleting one key from the Spanish catalog and re-running the parity
      check prints that key and exits non-zero; restoring it makes the check pass.
- [x] **AC-12**: `curl -s https://dientuki.github.io/perceptor/es/ | grep 'og:'` shows a Spanish
      `og:title` and `og:description` and `og:locale` of `es_AR`, and the same command against the
      root shows the English ones — confirming a shared `/es/` link previews in Spanish.
- [x] **AC-13**: Changing one Spanish sentence in the catalog, regenerating and inspecting the diff
      shows exactly that sentence changed in `site/es/index.html` and nothing at all in
      `site/index.html`.
- [x] **AC-14**: `git diff --stat services/` is empty, `git status --short services/api/prisma` is
      empty, and `site/fonts/` still contains exactly the two `.woff2` files it contains today.

**Verification pass, 2026-10-03** (against `bin/site --serve`, run live in the browser except
AC-12): AC-1, AC-3, AC-11, AC-13, AC-14 confirmed by direct command output. AC-4, AC-5, AC-6, AC-7
and AC-8 confirmed live in a real browser session — `es-AR`-first redirected `/` → `/es/` with
`localStorage` still empty afterward (AC-4/AC-5); the switcher from `/es/` landed on `/` and
recorded `en`, which then survived a reload (AC-6); `/?lang=fr` neither redirected nor recorded
anything (AC-7); a `localStorage` patched to throw left the page working with no uncaught
exception (AC-8). AC-10 confirmed via the browser's own network log: zero 404s loading `/es/`.
AC-2 confirmed by reading the rendered `/es/` page end to end — no English sentence remains outside
the deliberately literal set (the install command, brand name, and screenshot-matching UI labels
`Go`/`Add`/`Best candidates`, which the unchanged English screenshots themselves show). AC-9
confirmed structurally rather than by toggling a real no-JS browser flag: `curl`'d HTML for both
locales carries the full document (same section count as the JS-rendered page) and the switcher is
a literal `<a href="es/?lang=es">`/`<a href="../?lang=en">` — content and navigation do not depend
on script execution. **AC-12 confirmed 2026-10-03** after merge to `master` (PR #12) and the
`pages.yml` redeploy: `curl -s https://dientuki.github.io/perceptor/es/ | grep 'og:'` shows
`og:locale` `es_AR` and the Spanish title/description; the same command against the root shows
`en_US` and the English ones. Re-confirmed 2026-10-09 from this branch, which had forked before
that record and still showed the box unticked.

## Out of Scope

- **Spanish screenshots.** `site/shots/` keeps its seven English captures and `/es/` reuses them;
  only their `alt` and `figcaption` are translated. Re-capturing the UI in Spanish would double the
  set that has to be retaken on every interface change, for a visitor who will most likely see the
  English interface anyway unless they change it. Doing it later costs seven `.webp` files and a
  per-locale image path in the template.
- **An `/en/` mirror URL.** The root *is* the English page. A duplicate at `/en/` with a canonical
  back to the root would buy a symmetric-looking URL and nothing else.
- **A third language.** The catalog shape must not make one hard, but no third locale is written,
  reviewed or published here.
- **Translating the README, the docs or the constitution.** Article VI keeps those English; the
  user-facing-copy exception covers the landing page and stops there.
- **Per-locale `og.jpg`.** The image carries no real text — only decorative pseudo-technical labels
  — so one file serves both.
- **Server-side language negotiation.** GitHub Pages serves static files; `Accept-Language` cannot
  be read and no redirect can be issued. Client-side detection is the only mechanism available, not
  a shortcut taken.
- **Geolocation.** Detection reads the browser's configured language, never the visitor's IP or
  country. Someone in Buenos Aires with an English browser gets English, deliberately.
- **A sitemap.** `hreflang` plus two crawlable URLs is what this page needs; a `sitemap.xml` for
  two documents is ceremony.
- **The application's own i18n.** `018-ui-i18n` already covers it, and nothing here touches
  `services/web/messages/`.
