---
title: UI Internationalization — web slice
service: web
last_updated: 2026-08-19
status: Approved
---

# PLAN: UI Internationalization — `web` (`web/plan.md`)

# Read `services/web/AGENTS.md` first

This is not the Next.js in your training data. Next 16 renamed `middleware.ts` to `proxy.ts`, and
the App Router conventions this slice depends on have moved. Read
`services/web/node_modules/next/dist/docs/01-app/02-guides/internationalization.md` before writing
any code — its **Localization** half is the pattern this slice follows. Its **Routing** half
(`app/[lang]/`, locale sub-paths, `generateStaticParams` per locale) is exactly what REQ-4 forbids.
Do not follow it.

## Scope

`web` owns every string a user reads. It resolves the active locale, loads the catalog on the
server, renders all text translated, and turns the keys `api` sends into sentences.

`web` does **not** define the error keys — that vocabulary is `api`'s and lives frozen in
`../spec.md`. `web` does **not** build a language picker: the profile screen is out of scope, and a
header switcher is explicitly ruled out. `web` does not touch the database, ever (Article II).

Writes are confined to `services/web/` and this directory. Anything else is a stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/package.json` | Modified | `next-intl`, `negotiator`, `@formatjs/intl-localematcher` |
| `services/web/next.config.ts` | Modified | Wrap the existing config in `createNextIntlPlugin` — keep `reactCompiler`, `output: 'standalone'`, `images`, `allowedDevOrigins` |
| `services/web/messages/en.json` | New | The fallback catalog. Must be complete |
| `services/web/messages/es.json` | New | The existing Rioplatense copy, relocated (REQ-6) |
| `services/web/src/i18n/locales.ts` | New | `SUPPORTED_LOCALES`, `DEFAULT_LOCALE` — the one list REQ-17 allows |
| `services/web/src/i18n/negotiate.ts` | New | `Accept-Language` → locale, by language range (REQ-2) |
| `services/web/src/i18n/request.ts` | New | next-intl's `getRequestConfig`: the REQ-1 resolution order |
| `services/web/src/lib/graphql-error.ts` | New | `extensions.i18n` → translated string, falling back to `message` |
| `services/web/src/lib/auth-session.ts` | Modified | Match on keys, not on Spanish sentences (REQ-14) |
| `services/web/src/actions/auth.ts` | Modified | `me { uiLocale }`; extract a non-redirecting, `cache()`d `getCurrentUserOrNull` |
| `services/web/src/actions/locale.ts` | New | `setUiLocaleAction` |
| `services/web/src/app/layout.tsx` | Modified | `async`, real `<html lang>`, `NextIntlClientProvider` |
| `services/web/scripts/check-messages.mjs` | New | Catalog parity check (AC-12) — a script, not a test runner |
| `services/web/src/actions/*.ts` (12 files) | Modified | Error strings via `graphql-error.ts` |
| `services/web/src/components/**` (~18 files) | Modified | Literals → catalog |
| `services/web/src/app/**` (6 files) | Modified | Landing, both `not-found.tsx`, every `metadata` |
| `services/web/src/layout/AppSidebar.tsx`, `src/components/header/UserDropdown.tsx` | Modified | The **English** literals REQ-5 also covers |

## Existing code to reuse

- **`getCurrentUser()` — `src/actions/auth.ts:115`.** Reuse it; add `uiLocale` to `ME_QUERY`. But it
  calls `redirectToClearSession(errors)` on an auth error, so it **must not** be called from
  `getRequestConfig`: an anonymous hit on `/login` would redirect to `/api/auth/clear-session` and
  straight back, a loop of the same species `004-user-disable` had to fix. Extract
  `getCurrentUserOrNull()` — same query, returns `null` instead of redirecting — wrap it in React's
  `cache()`, and have both `getCurrentUser()` and the locale resolver call it. That keeps one `me`
  round trip per request instead of two.
- **`fetchGraphQL` — `src/lib/graphql-client.ts`.** Do **not** change it. It already returns the raw
  error objects, so `extensions` is already arriving; only its own Spanish fallback string moves to
  the catalog.
- **The server-action shape** documented in `services/web/CLAUDE.md`. Keep it exactly: `'use server'`
  on line 1, `const NAME_MUTATION` in SCREAMING_SNAKE, read functions `throw`, form actions return
  `{ error?: string } | { success: true }`. Only how `error` is *derived* changes. Copy
  `src/actions/media-server.ts` for `locale.ts`; do not invent a variant.
- **`redirectIfUnauthenticated` vs `redirectToClearSession`** — the distinction is by caller context,
  not resemblance (`services/web/CLAUDE.md`). Re-derive it for anything new; do not copy whichever
  is nearest.
- **`LanguagePicker` / `PreferredLanguagesCard`** — do not touch beyond string extraction. That is
  the **media** language preference, a different feature. Their labels are catalog entries; their
  behaviour is not in scope.
- **`Intl.DisplayNames`** — the platform API, for REQ-13. Language names are **not** catalog entries;
  twenty names × N locales duplicated into every file is how a catalog rots.

## Steps

1. Install the three dependencies through `bin/npm web install …` (Article I — never bare `npm`).
2. Write `src/i18n/locales.ts` and `src/i18n/negotiate.ts`. Negotiation is by language range:
   `es-AR`, `es-419` and `es` all resolve to `es`; an all-unsupported header falls to `en` (REQ-2).
3. Extract `getCurrentUserOrNull()` in `src/actions/auth.ts`, `cache()`-wrapped, and add `uiLocale`
   to `ME_QUERY`. Leave `getCurrentUser()`'s redirect behaviour intact for its existing callers.
4. Write `src/i18n/request.ts` implementing REQ-1's order: user row → header → `en`. It must
   tolerate an unauthenticated request without redirecting.
5. Wire `createNextIntlPlugin` into `next.config.ts`, preserving every existing option.
6. Make `src/app/layout.tsx` async: resolve the locale, set `<html lang>` (REQ-16), wrap the tree in
   `NextIntlClientProvider` with the server-loaded catalog (REQ-3). **Run `bin/npm web run build`
   here, before touching any copy** — this is the step most likely to break prerendering, and
   finding that out after forty files of string extraction makes the cause unfindable.
7. Write `src/lib/graphql-error.ts`: read `extensions.i18n.key`, `JSON.parse` `params` if present,
   translate; fall back to `message`; **never** render a bare key.
8. Migrate `src/lib/auth-session.ts` to match `error.auth.unauthenticated` and
   `error.auth.session_expired` off `extensions.i18n.key` (REQ-14). Delete `SESSION_ERROR_MESSAGES`.
9. Rewrite the twelve `src/actions/*.ts` to derive their error strings through `graphql-error.ts`.
   The passthrough comments in `users.ts:76-77,112-113,152-154` describe behaviour that is
   preserved — the API's exact reason still reaches the screen — so update them rather than deleting
   the intent.
10. Add `src/actions/locale.ts` with `setUiLocaleAction`. No UI calls it yet; that is expected.
11. Extract every literal into `messages/en.json` + `messages/es.json`, screen by screen. Include the
    English-only leftovers (`AppSidebar`, `UserDropdown`, every `PageBreadcrumb pageTitle`, every
    `metadata.title`) and delete the two TailAdmin boilerplate titles on `/movies/add` and
    `/shows/add` (REQ-5). Keep the Rioplatense register in `es` (REQ-6).
12. `SeasonAccordion.tsx:54` — pass the active locale to `toLocaleDateString()` (REQ-15).
13. Render language names with `Intl.DisplayNames` and sort with `localeCompare(activeLocale)`
    (REQ-13).
14. `importFileModal.tsx` — read `i18n.key` off the REST error body from `/uploads` (REQ-10). This is
    the one error path that is not GraphQL.
15. Write `scripts/check-messages.mjs`: exit non-zero listing any key present in one catalog and
    absent from the other (AC-12, NFR-1).

## Contract obligations

`web` consumes, and must handle, every error condition in `../spec.md` § GraphQL Contract Delta —
that document is read-only. There is no codegen: a consumer that handles only the happy path
compiles fine and fails at runtime.

- Read `extensions.i18n = { key, params? }`; `params` is a **JSON-encoded string**, so `JSON.parse`
  it. It is absent for keys that take no interpolation.
- Always fall back to the error's English `message` when the key is unknown. Rendering the key
  itself is a defect (NFR-1).
- `error.auth.unauthenticated` and `error.auth.session_expired` drive the redirect in
  `auth-session.ts`. Nothing else may.
- `me { uiLocale }` is nullable — `null` means "not set", not "English".
- `supportedLocales` is the authority for what `setUiLocale` accepts; `setUiLocale` rejects anything
  else with `error.user.unsupported_locale`, and `setUiLocaleAction` must surface that rather than
  assuming success.
- Every key in `messages/en.json` and `messages/es.json` must cover the whole error vocabulary in
  `../spec.md`, not just `web`'s own UI strings.

## Tests

**None, and that is a deliberate outcome, not an omission.** `services/web` has no test runner and
NFR-6 forbids adding one — introducing Vitest or Playwright here is its own decision
(`services/web/CLAUDE.md`). The quality gate for this slice is the typecheck, `next build`, Biome on
the files you touched, and actually opening each screen in both locales.

`scripts/check-messages.mjs` is **not** a test: it is a plain node script covering AC-12, so catalog
drift — the one failure here that is genuinely silent — is caught by a command rather than by a user
finding an untranslated screen.

Note that `bin/npm web run lint` reports ~1598 pre-existing Biome errors across the TailAdmin
template with or without any change. Judge a file by running Biome on **that file**.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/npm web run build
bin/cli web node scripts/check-messages.mjs
```

Typecheck reports **0 errors** and the build exits **0** — both were closed by
`016-web-build-errors` and must stay closed (NFR-5). None of that feature's banned escape hatches
may appear: no `ignoreBuildErrors`, no `dynamic = "force-dynamic"` added to dodge a prerender
failure, no React Compiler suppression. `check-messages.mjs` exits 0.

Then open `/`, `/login`, `/dashboard`, `/movies`, `/shows`, `/settings`, `/users` and one detail page
in **both** locales, and confirm no text flashes or changes after hydration (REQ-3).
