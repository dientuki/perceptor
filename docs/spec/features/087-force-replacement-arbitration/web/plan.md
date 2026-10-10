---
title: Force is consent, arbitration is the arbiter's — web slice
service: web
last_updated: 2026-10-06
status: Implemented
---

# PLAN: Force is consent, arbitration is the arbiter's — `web` (`web/plan.md`)

Read `../spec.md` and `../plan.md` first. The GraphQL delta there is read-only.

## Scope

This slice is deliberately thin, and the reason is worth stating so nobody widens it: the replacement
warning, the Replace control and the `errorKey`-driven retry **already work**, for every target this
feature broadens the guard to. `api` answers one of the three `error.*.already_completed` keys,
`ALREADY_COMPLETED_KEYS` matches it on `errorKey`, and the confirm control re-issues the call with
`force: true` — none of which cares why `api` decided the target needs confirmation. So `web` owes two
things: the Spanish and English copy for the one new key, and a verification that REQ-10 holds — that
`isAcquisitionTargetCompleted` stays a pre-check and never becomes a gate.

Not in this slice: any change to `force`'s meaning or plumbing (`api` owns it), any new component, any
new error branch, and anything to do with `/downloads`' rendering beyond the catalog entry the existing
`DownloadErrorLine` reads.

Writes are confined to `services/web/` and this directory. Anything else is a stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `messages/en.json` | Modified | `errors.source.superseded` |
| `messages/es.json` | Modified | the same key, Rioplatense register |

Two files, two lines. A new component or a new `lib/` helper in this slice means the plan missed
something — report it rather than adding one.

## Existing code to reuse

- `src/lib/graphql-error.ts` — `translateErrorKey(t, key, params, message)`. It resolves
  `errors.<dotted key>` out of the catalog and falls back to `api`'s English `message` when the key is
  absent. This is why the catalog entry is the whole slice, and why the two services can land in either
  order without a broken intermediate state.
- `src/components/downloads/DownloadErrorLine.tsx` — already renders any `lastError` through
  `translateErrorKey`, prefixed by its `stage` label when the stage is in `KNOWN_STAGES`. A superseded
  source arrives with `stage: "SCAN"`, which that list already knows; **do not** add a stage value or a
  key-specific branch here (`../plan.md` § Contract Freeze).
- `src/components/search/SearchTorrent.tsx:30` and
  `src/components/import/importMagnetModal.tsx:29` — `ALREADY_COMPLETED_KEYS`, matched against
  `result.errorKey`. Already correct for REQ-10; the verification step below reads them rather than
  editing them.
- `src/lib/acquisition-target.ts:10` — `isAcquisitionTargetCompleted`. Stays exactly as it is: a
  pre-check that shows the warning before the round trip for the common case, never a condition that
  suppresses the retry.
- `messages/{en,es}.json` → `errors.source.*` — the existing block (`replaced`, `scan_no_video`,
  `scan_failed`, …) is where the new key goes, in the same register as its neighbours.

## Steps

1. Add `errors.source.superseded` to `messages/es.json`, beside the existing `replaced`:
   `"Otra fuente de este título ya se estaba procesando"` — the exact string `../spec.md` § GraphQL
   Contract Delta and AC-7 name. Note the past tense, which distinguishes it from the existing
   `errors.download.retry_superseded` ("ya se está procesando", the refusal on the Play control): one
   explains why this source stopped, the other why it cannot be resumed, and the same row shows both.
2. Add the same key to `messages/en.json`, matching `api`'s English rendering from
   `src/i18n/messages.en.ts` so the catalog and the fallback never disagree.
3. Verify REQ-10 without changing it: in both `SearchTorrent.tsx` and `importMagnetModal.tsx`, confirm
   that a submit with `force: false` whose `errorKey` is in `ALREADY_COMPLETED_KEYS` sets the confirm
   state **regardless** of `isCompleted`, and that the confirm control re-issues with `force: true`.
   Report what you found; change nothing if it already holds, and stop and report if it does not —
   a fix there is a behavioural change this plan did not budget for.

## Contract obligations

`web` consumes, and must keep handling, every error condition in `../spec.md` § GraphQL Contract
Delta:

- `error.movie.already_completed` / `error.episode.already_completed` /
  `error.season.already_completed` — show the replacement warning and offer a confirm that re-issues
  with `force: true`. **The condition behind these keys broadens in this feature**: they now also come
  back for a target whose status is not `COMPLETED`. The handling does not change, but a pre-check that
  short-circuits on `status === "COMPLETED"` would silently drop the warning for exactly the case this
  feature adds.
- `error.movie.download_in_progress` and its twins — unchanged, keep today's affordance.
- `error.source.superseded` — new, arrives on a `MediaSource` row via `Download.lastError`, rendered by
  the existing path. Never thrown as a GraphQL error, so no action branch consumes it.
- `error.upload.superseded` — unchanged `409` on a losing upload.
- `error.download.retry_superseded` — unchanged; already the `refusalKey` that keeps a superseded
  source's Play control refused (REQ-6), and already in both catalogs.

There is no codegen. A key added to `api` and not to these two catalogs degrades to English rather than
breaking, which is a quiet regression, not a crash — that is the whole reason this slice exists.

## Tests

`web` has no test runner (`package.json` carries `dev`/`build`/`start`/`lint`/`format` only), and
nothing in this slice can fail silently in a way a test would catch: a missing catalog key renders
`api`'s English text, which is visible on screen. Article IX is satisfied by the manual pass in
`../plan.md` § Verification, step 3 — `/downloads` with `uiLocale = es` showing the Spanish string with
no English leaking through (AC-7).

Explicitly not owed: a test for `translateErrorKey`'s fallback (it already has the behaviour and this
slice does not change it).

## Done when

```bash
bin/npm web run lint
bin/npm web run build
bin/comments web
```

All three exit 0, and `messages/en.json` and `messages/es.json` both parse with the new key present
under `errors.source`:

```bash
bin/cli web node -e "for (const l of ['en','es']) { const m = require('./messages/'+l+'.json'); if (!m.errors.source.superseded) { console.error(l+': missing'); process.exit(1); } } console.log('both catalogs: ok')"
```

**Never run `bin/npm web run build` while the dev stack is serving** — it overwrites `.next` and
un-hydrates every page until the dev server rebuilds.
