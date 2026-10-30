---
title: Automatic Offset for Subtitle Embed — web slice
service: web
last_updated: 2026-10-30
status: Implemented
---

# PLAN: Automatic Offset for Subtitle Embed — `web` (`web/plan.md`)

## Scope

`web` adds the "Automático" checkbox to each row of the embed dialog, checked by default, and sends
`autoOffset` with each selected sidecar. It also renders `SYNCING` as an in-flight state labelled
"Sincronizando subtítulos…" and translates the five new failure keys through the existing failure
line.

It does **not** measure, validate a measured offset or poll. The button reflects the row's status
on the next `router.refresh()`, as `101` already does for `QUEUED`/`RUNNING`.

Writes are confined to `services/web/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/types/media.ts` | Modified | `SubtitleEmbedStatus` gains `"SYNCING"`; `SubtitleEmbedInput.autoOffset: boolean` |
| `src/components/media/EmbedSubtitlesModal.tsx` | Modified | `RowState.autoOffset` (initially `true`); the checkbox; validity and payload |
| `src/components/media/EmbedSubtitlesButton.tsx` | Modified | In-flight means anything not `COMPLETED`/`FAILED`; `SYNCING` uses the new label |
| `messages/en.json`, `messages/es.json` | Modified | `media.embedSubtitles.autoOffset`, `media.embedSubtitles.syncing`, and `errors.subtitleEmbed.sync_failed`/`sync_framerate_mismatch`/`sync_offset_too_large`/`sync_incomplete`/`sync_low_score` |

`src/actions/movies.ts`/`shows.ts` need no change. They forward the `SubtitleEmbedInput[]` the
modal builds as the `$subtitles` variable, so the new field rides along. Confirm that the mutation's
variable type is `[SubtitleEmbedInput!]!` and that no field allowlist strips it.

## Existing code to reuse

- **`EmbedSubtitlesModal`'s `update()`/`rowFor()` row state.** The checkbox is one more
  `Partial<RowState>` patch. Do not add a second state store.
- **The existing "make default" checkbox markup** (`label.flex.items-center.gap-2`). The
  "Automático" checkbox copies it and sits beside the offset input.
- **`translateErrorKey`** in `EmbedSubtitlesButton`'s `reasonOf`. The new `sync_*` keys go through
  it unchanged once they are in both catalogs.
- **`scripts/check-messages.mjs`.** Catalog drift between `en.json` and `es.json` fails it.

## Steps

1. **Types.** Add `"SYNCING"` to `SubtitleEmbedStatus` and `autoOffset: boolean` to
   `SubtitleEmbedInput`.
2. **Modal state.**
   - `initialRows` sets `autoOffset: true` and keeps `offset: "0"`.
   - Validity: a row needs `parseOffset(row.offset) !== null` only when `!row.autoOffset`.
   - The payload sends `autoOffset: row.autoOffset` and `offsetMs: row.autoOffset ? 0 :
     parseOffset(row.offset)`. `0` is what the frozen contract expects for an ignored `offsetMs`.
3. **Modal markup.**
   - The checkbox goes beside the offset input, labelled `t("autoOffset")`.
   - `disabled={!row.include}`; `onChange` patches `autoOffset`.
   - The offset input becomes `disabled={!row.include || row.autoOffset}`, and `aria-invalid` only
     applies when it is enabled.
   - The existing `include` toggle leaves `autoOffset` as it was.
4. **Button.**
   - `inFlight = embed != null && embed.status !== "COMPLETED" && embed.status !== "FAILED"`, so a
     future unknown status never reads as idle (spec contract note).
   - The label is `t("syncing")` when `embed.status === "SYNCING"`, else `t("embedding")`. This
     applies both to the button's `title`/text and to the compact `<span>`.
5. **Copy.**
   - `es`: `autoOffset` "Automático", `syncing` "Sincronizando subtítulos…".
   - `en`: "Automatic", "Syncing subtitles…".
   - The five `errors.subtitleEmbed.sync_*` strings are verbatim from `../spec.md`'s table for
     `es`, with English equivalents for `en`.

## Contract obligations

`web` consumes the following from `../spec.md`:

- **`SubtitleEmbedInput.autoOffset: Boolean!`.** It defaults server-side to `false`, but `web`
  always sends it explicitly.
- **`SubtitleEmbedStatus.SYNCING`.**
- **The stored failure keys**, rendered through `t("failed", { reason })`:
  - `error.subtitleEmbed.sync_failed`
  - `sync_framerate_mismatch`
  - `sync_offset_too_large`
  - `sync_incomplete`
  - `sync_low_score`
  - `interrupted` (existing)
- **Synchronous errors from the mutation.** These are unchanged: `busy`, `offset_out_of_range`
  (now only for a manual row) and `stale_listing` (already handled with `onStale`). They surface
  through the existing `setError` path.

The service-only operations and the queue job are not `web`'s concern.

## Tests

`web` has no test runner (`services/web/CLAUDE.md`), so nothing here is owed a unit test.

The silent failure in this slice is a status the button does not know reading as idle, which would
let the user open the dialog over a `SYNCING` embed. That is closed by construction in step 4,
where in-flight is defined by exclusion, and it is checked in the live pass (AC-1, AC-2, AC-6).
Catalog drift is caught by `check-messages.mjs`.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/npm web run lint
bin/cli web node scripts/check-messages.mjs
bin/comments web
```

Typecheck and lint are clean, and every new key exists in both `en.json` and `es.json`. Never run
`bin/npm web run build` while the dev stack is up.
