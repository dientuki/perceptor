---
title: Pipeline Error Visibility and Resume — web slice
service: web
last_updated: 2026-09-19
status: Implemented
---

# PLAN: Pipeline Error Visibility and Resume — `web` (`web/plan.md`)

## Scope

The download row shows the last error (stage + translated message) and shows Play on an `ERROR`
row exactly when `api` says it is retryable, including on an upload. Every key that can appear on
`lastError` or come back from `downloadStart` is translated in both catalogs.

Not this slice: deciding retryability (`api`'s `retryable` is the rule — never re-derive it from
`stage` or `key`), resuming anything (Play keeps calling the same `startDownloadAction`), the
worker.

Writes are confined to `services/web/`.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/types/downloads.ts` | Modified | `DownloadError`, `lastError`, `retryable` |
| `src/actions/downloads.ts` | Modified | `DOWNLOAD_FIELDS` selects the new fields |
| `src/lib/graphql-error.ts` | Modified | extract the key → catalog lookup into a pure helper both sides use |
| `src/components/downloads/DownloadRow.tsx` | Modified | error line; Play visibility |
| `src/components/downloads/DownloadErrorLine.tsx` | New | renders `lastError` (one component per file, `053`) |
| `messages/en.json`, `messages/es.json` | Modified | keys below |

## Existing code to reuse

- `src/lib/graphql-error.ts`'s `translateGraphQLError` — strips `error.`, checks `t.has`,
  interpolates, falls back to the English message, never returns the raw key. It is server-only
  (`getTranslations`). Extract the body into a pure function taking a translator (`t`, with `has`),
  the key, a params object and the fallback message; `translateGraphQLError` calls it with the
  server translator, `DownloadErrorLine` with `useTranslations("errors")`. One rule, two call sites.
- `DownloadRow.tsx`'s existing `rowError` line and `startDownloadAction` error handling — the new
  refusal keys come back through `toActionError` and already render there once the catalog has them.
  No new branch in the action.
- `StatusBadge` — unchanged; `ERROR` already has a badge.

## Steps

1. Types: `DownloadError { stage: string; key: string; params: string | null; message: string }`;
   `Download.lastError: DownloadError | null`, `Download.retryable: boolean`. Add both to
   `DOWNLOAD_FIELDS` (`lastError { stage key params message }`, `retryable`).
2. Extract the translation helper (step above). `translateGraphQLError`'s behaviour must not change.
3. `DownloadErrorLine`: parse `params` with `JSON.parse` inside a `try` (a bad string → no params,
   still translate the key or fall back to `message`); render the stage label
   (`downloads.panel.stage.{DOWNLOAD,SCAN,ENCODE,REPLACED}`, unknown stage → no label) and the
   translated message, styled like the existing `rowError` line.
4. `DownloadRow`: render `DownloadErrorLine` when `lastError` is non-null. Play renders when
   `download.status === "ERROR" ? download.retryable : isControllable`. Stop keeps `isControllable`.
   Nothing else in the row changes.
5. Catalogs, `en` and `es` (Rioplatense), under `errors`:
   - `download.torrent_client_error` `{state}`, `download.retry_replaced`,
     `download.retry_superseded`, `download.retry_unavailable`, `download.retry_enqueue_failed`
     (texts from `../spec.md`'s tables);
   - `source.scan_failed` `{detail}`, `source.scan_no_video`, `source.scan_no_downloaded_video`,
     `source.no_download_path`, `source.no_target`, `source.match_not_reported`, `source.replaced`,
     `processJob.recovery_exhausted`;
   - every `error.encode.*` key in `services/worker/src/i18n/error-keys.ts`, with the params
     `services/worker/src/i18n/messages.en.ts` interpolates — read those two files, do not guess
     param names.
   Also `downloads.panel.stage.*` (four labels). If `es` already has some of these, keep its text.
6. `bin/cli web node scripts/check-messages.mjs`.

## Contract obligations

Consumes from `../spec.md`: `Download.lastError` (nullable; `params` is a **JSON-encoded string**,
the opposite of `extensions.i18n.params`, which `059` confirmed is an object), `Download.retryable`
(false on every non-`ERROR` row). `downloadStart`'s errors, and what the row does with each:

| Key | Row behaviour |
| :-- | :-- |
| `error.source.not_found` | existing `rowError` |
| `error.download.not_a_torrent` | existing `rowError` (unreachable from the UI now: Play on a non-`ERROR` upload is not rendered) |
| `error.download.torrent_client_rejected` | existing `rowError` |
| `error.download.retry_replaced` / `retry_superseded` / `retry_unavailable` | `rowError`, then `router.refresh()` so the row picks up `retryable: false` and hides Play |
| `error.download.retry_enqueue_failed` | `rowError` only; the row is unchanged and Play stays |

The refresh-after-refusal is the one new branch: compare `result.errorKey` against the three keys,
never the translated text.

## Tests

None — `web` has no test runner (`services/web/CLAUDE.md` § Tests). The silent failures here are a
missing catalog key (caught by `check-messages.mjs` for drift, and by the manual `es` pass for a key
missing from both) and a `params` string that isn't parsed (visible as `{state}`/`{detail}` shown
literally — AC-2/AC-3 in `es` check it).

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/npm web run build
bin/cli web node scripts/check-messages.mjs
```

0 type errors, build exits 0, no `en`/`es` drift.
