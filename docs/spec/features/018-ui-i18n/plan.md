---
title: UI Internationalization — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-08-19
status: Approved
---

# PLAN: UI Internationalization (`plan.md`)

## Approach

The feature has two halves that meet at the GraphQL seam, and they are solved by two different
mechanisms on purpose.

**`web` renders text.** It adopts `next-intl` (4.13.7, which declares `next: ^16.0.0` and
`react: ^19` as peers — verified against the registry, so no compatibility spike is needed) in its
**without-i18n-routing** mode. That mode exists precisely for this case: the locale is resolved by a
`getRequestConfig` callback rather than read off a `[lang]` route segment, so REQ-4 holds by
construction — there is no route to localize. The catalogs are two JSON files, exactly the
dictionary shape Next's own guide describes
(`services/web/node_modules/next/dist/docs/01-app/02-guides/internationalization.md` § Localization),
minus the `[lang]` routing half of that guide, which does not apply. Server Components translate
during their render pass; the ~25 client components get their messages from
`NextIntlClientProvider`, which is handed a catalog the **server** already loaded — no client fetch,
so REQ-3 holds.

**`api` and `worker` stop rendering text and start emitting keys.** Nest's `HttpException` already
accepts an object as its response body, so a keyed error needs no new transport: the exception
carries `{ message, i18n: { key, params } }`, and one `formatError` hook on
`GraphQLModule.forRoot` — currently unset in `services/api/src/app.module.ts:28-41`, so this is a
clean insertion, not a rewrite — lifts `i18n` into `extensions`. That is the whole mechanism. The
sixty-four throw sites change what they pass, not how they throw.

Two pieces of reuse decide the shape of the `web` slice:

- **`getCurrentUser()` in `services/web/src/actions/auth.ts` is reused, not duplicated** — the `me`
  query simply selects one more field. But it **cannot be called as-is** from locale resolution:
  it calls `redirectToClearSession(errors)` on an auth error (`auth.ts:118-127`), which would make
  every unauthenticated visit to `/login` redirect to `/api/auth/clear-session` and back — a loop,
  and the same class of loop `004-user-disable` had to fix. The slice therefore extracts a
  non-redirecting `getCurrentUserOrNull()` that both callers share, and wraps it in React's `cache()`
  so the dashboard layout and the locale resolver make **one** `me` call per request, not two.
- **`fetchGraphQL` (`services/web/src/lib/graphql-client.ts`) is untouched.** It already returns
  `{ data, errors }` with the raw error objects, so `extensions` is already reaching every caller —
  nothing about the client needs to change for keys to arrive. What changes is a new helper the
  twelve server actions call to turn an error into a string, replacing the twelve hand-copied
  `errors[0]?.message || "…"` expressions.

`Intl.DisplayNames` covers REQ-13 with no catalog entries at all: twenty language names times N
locales is data the platform already ships, and duplicating it into every catalog is how a
translation set rots. `services/api/src/languages/language-names.ts` becomes English and stops being
the display authority.

**Alternative considered and rejected:** mirroring `uiLocale` into a cookie at login so the locale is
readable without a GraphQL call. It is faster, and it is wrong — the cookie goes stale the moment
the user changes their locale from another device, giving two sources of truth for a value the spec
says lives on the user row. `cache()` makes the extra call free within a render pass, which was the
only real argument for the cookie.

## Order of Work

`api` first, and strictly first. It owns the migration, the schema and the key vocabulary that both
consumers translate against; neither `web` nor `worker` can be written against a contract that does
not exist yet. `worker` additionally cannot compile against `encodeFailed`'s new signature until
`api` exposes it.

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the migration (`uiLocale`, `errorKey`/`errorParams`), the `formatError` hook, the key vocabulary and the English catalog every consumer falls back to |
| 2 | `web` | Cannot select `me { uiLocale }`, call `setUiLocale`, or read `extensions.i18n` before step 1 exists |
| 2 | `worker` | Cannot call `encodeFailed(errorKey:…)` before step 1 changes its signature |

**Steps 2 run in parallel.** They touch disjoint services, share no file, and both read the same
frozen contract. They must not start before step 1's contract surface is in place — before that,
"parallel" means each inventing its own idea of what a key looks like.

Within step 1 there is an internal order the `api` slice must respect: the migration and the
`src/i18n/` vocabulary land **before** the sixty-four throw sites are rewritten. A throw site keyed
against a key constant that does not exist yet is churn, not progress.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. Implementers read
it; they do not edit it. Four things will look wrong from inside one service and are right for the
feature:

- **`errorParams` is a `String` holding JSON, not a JSON scalar.** The `api` implementer will want to
  add `graphql-type-json` and make it a real scalar; the `web`/`worker` implementers will want to
  stop calling `JSON.parse`. Do not. There is no codegen across this seam, and a scalar that
  serializes differently on either side fails at runtime with no compile error anywhere — the exact
  failure Article VIII exists to prevent. A string both sides parse is honest about what is actually
  guaranteed.

- **`message` stays on every error, in English.** It looks redundant next to a key. It is the
  fallback that makes a key `web` has never heard of degrade into a readable English sentence
  instead of a raw `error.movie.not_found` on screen — see Risk 2, where it is the primary
  mitigation, not a nicety.

- **`encodeFailed` keeps `errorMessage` as a required argument** alongside the new `errorKey`.
  The `worker` implementer will read that as duplication. It is what keeps `NFR-3` true going
  forward: `ProcessJob.errorMessage` remains readable without a catalog, which is what makes a row
  legible from `bin/mysql` and from `api`'s own logs.

- **`ProcessJob.errorKey`/`errorParams` are stored and not exposed on any GraphQL type.** The `api`
  implementer will want to add the fields for symmetry with `MediaSource`. Do not — `ProcessJob.
  errorMessage` is not exposed today either, and surface with no consumer is contract rot.

If the contract turns out to be wrong: stop, amend `spec.md`, re-approve, re-brief all three
services. Never patch it from inside one slice (Constitution, Article VIII).

## Migrations

One migration, owned by `api`, additive only.

1. `add_ui_locale_and_error_keys` — five `ALTER TABLE … ADD COLUMN` statements:
   `users.uiLocale VARCHAR(35) NULL`, `media_sources.errorKey VARCHAR(100) NULL`,
   `media_sources.errorParams TEXT NULL`, `process_jobs.errorKey VARCHAR(100) NULL`,
   `process_jobs.errorParams TEXT NULL`.
2. **Backfill: none** (spec NFR-2, decided explicitly by the user). Every existing user gets
   `uiLocale = NULL` and therefore resolves through `Accept-Language`. The accepted consequence is
   that on an existing install a user whose browser is English sees Perceptor in English after this
   upgrade, where they saw Spanish before. Every pre-existing `errorMessage` row keeps its Spanish
   text with a null key, which NFR-3 requires to keep rendering.

Generated through `bin/npm api run prisma:migrate` (Article III) — `schema.prisma` and the migration
directory move together or the change is a violation.

**Reversibility**: fully reversible. Dropping the five columns loses only stored locale preferences
and error keys; `errorMessage` still holds a readable sentence on every row, and a null `uiLocale`
is already a valid state meaning "negotiate from the header". Nothing in the pipeline reads these
columns to make a decision.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| **Auth detection breaks (REQ-14)** | `web` switches `auth-session.ts` from matching `'No autenticado'` to matching `error.auth.unauthenticated`, but one of `api`'s five auth throw sites ships without the key. Session invalidation silently stops: the cookie is never deleted, `proxy.ts`'s presence-check bounces the user back to `/dashboard`, and they sit in a loop with a dead session. No error is logged anywhere. | `api` owes a spec asserting **every** auth throw site carries one of the two keys (`api/plan.md` § Tests). AC-5 re-runs `004-user-disable`'s live acceptance test in both locales. This is the single highest-risk item in the feature. |
| **Key drift between services** | `api` emits a key `web`'s catalogs do not have. No compiler crosses the seam; nothing fails. | REQ-8's English `message` fallback is the mitigation, and it is deliberate: a Spanish user sees an English sentence — wrong, but *visible and reportable* — instead of a raw key or a blank. `spec.md`'s error table is the authoritative vocabulary; `docs/spec/graphql-contract.md` gains an `018` section listing it. A cross-service automated check is impossible here (`web`'s container bind-mounts only `./services/web`, so no one container can read both key lists) — this is why the fallback carries the weight rather than a script. |
| **`encodeFailed` signature skew** | `worker` calls the old two-argument form against a new `api`. The call fails, and `encode.job.ts:139`'s trailing `.catch(...)` **swallows it into a console line**. The `ProcessJob` never leaves `ENCODING`, the user sees a job stuck forever, and no error surfaces. | The two services ship together (step 2 is one release with step 1, not after it). `api` owes a resolver test on the new arity. Called out explicitly in `worker/plan.md`. |
| **Locale resolution redirect loop** | `getRequestConfig` calls the existing `getCurrentUser()`, which calls `redirectToClearSession` on an auth error. Every anonymous hit on `/login` redirects to `/api/auth/clear-session` and back. | The non-redirecting `getCurrentUserOrNull()` is a required step in `web/plan.md`, not an implementer's choice. `/login` and `/` are explicit manual-pass items in Verification. |
| **Prerender regression** | Resolving the locale in the root layout reads request state, pushing `/` and `/login` from static to dynamic — or failing `next build` outright at "Generating static pages", the exact wall `016-web-build-errors` hit. | NFR-5 makes `bin/npm web run build` a gate. `016`'s banned escape hatches stay banned: no `ignoreBuildErrors`, no `dynamic = "force-dynamic"` sprinkled to dodge it, no compiler suppression. If a page genuinely must become dynamic, that is a reported outcome, not a silent one. |
| **Internal string-matching in `uploads`** | `services/api/src/uploads/uploads.service.ts:122-123` classifies ticket failures by comparing `Error.message` against strings thrown in `upload-tickets.service.ts`. Keying one side and not the other makes every ticket error fall to the generic branch — a 401 where a 403 belongs, with no crash. | `api/plan.md` makes this an explicit step, not a drive-by. It is the internal twin of the `auth-session.ts` coupling. |
| **`es` catalog drifts from `en`** | A key exists in one and not the other; the gap only shows when a user hits that exact path. | AC-12's `bin/cli web node scripts/check-messages.mjs`, a plain script — **not** a test framework, so NFR-6 holds. |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
bin/cli web npx --no tsc --noEmit
bin/npm web run build
bin/cli web node scripts/check-messages.mjs
bin/cli api npx prisma migrate status
```

Then the manual pass, which is where the acceptance criteria actually get met:

1. **AC-1** — fresh user, browser in English: `/dashboard` renders English. Confirm
   `me { uiLocale }` is `null` in the Apollo playground.
2. **AC-2** — run `setUiLocale("es")` in the playground, reload `/dashboard` with the browser still
   in English: Spanish renders, URL unchanged.
3. **AC-3** — set `uiLocale` back to null, switch the browser to Spanish (Argentina): Spanish.
   Switch it to French: English.
4. **AC-4** — visit `/movies/999999`: the unavailable page renders in the active locale; the same
   query in the playground shows `extensions.i18n.key = "error.movie.not_found"`, `params.id`, and
   an English `message`.
5. **AC-5** *(the important one)* — sign in as a second user in another browser, disable that user
   from `/users`, then navigate in the second browser. It must land on `/login` with the cookie
   gone. **Run this in both locales.**
6. **AC-6** — `setUiLocale("kl")` is refused with `error.user.unsupported_locale`; `me { uiLocale }`
   is unchanged.
7. **AC-7** — feed an audio-only file through the pipeline, then
   `bin/mysql -e 'select id, errorKey, errorMessage from process_jobs order by id desc limit 1'`.
8. **AC-8** — add `messages/pt.json` and one entry to the supported list; confirm `supportedLocales`
   includes `pt`, `setUiLocale("pt")` succeeds, the UI renders Portuguese, and `git status` shows
   exactly one new and one modified file. Revert afterwards.
9. **AC-9/AC-11** — search `services/web/src` for Spanish outside the catalog; confirm a
   pre-existing `media_sources` row with a null `errorKey` still shows its stored text.
10. **`/` and `/login` load anonymously** — no redirect loop, correct language from the header.
