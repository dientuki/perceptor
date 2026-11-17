---
title: Subtitle Search and Replace — Implementation Plan
spec_version: 0.1.1
last_updated: 2026-11-15
status: Implemented
---

# PLAN: Subtitle Search and Replace (`plan.md`)

## Approach

Replace is a manual search with two extra facts carried through the existing path, not a new
pipeline. The ticked languages are validated and snapshotted on the `SubtitleSearch` row when the
search is created (`SubtitleSearchRequestService.requestForCaller`). From there:

- The driver treats a ticked language as missing: the one place that decides this,
  `SubtitleSearchDriver.missingLanguages`, subtracts the ticked set from `presentLanguages`.
  Searching, validating, the `118` variant rule and the 3-attempt cap all follow unchanged because
  they already iterate `missingLanguages`.
- When the driver embeds the accepted candidates (`embedding` → `SubtitleEmbedService.embedStaged`),
  it passes the subset of ticked languages that actually got an accepted candidate. That list is
  stored on the `SubtitleEmbed` row and exposed to the worker on `SubtitleEmbedDetails`. A ticked
  language with no accepted candidate is never passed, so REQ-6 holds without the worker knowing
  anything about the search.
- The worker's `subtitle-embed` job drops, in the same `mkvmerge` call, every existing text subtitle
  track of a listed language that is not forced, and `verifyEmbed` learns to expect those streams
  to be gone. The worker decides which stream indexes to drop from its own `ffprobe`, because only
  it sees the file; `api` sends languages, never indexes.
- `deriveLanguages` reports `REPLACED` for a ticked language whose candidate was accepted and whose
  search completed, and lets a ticked language's `NOT_FOUND`/`REJECTED`/`FAILED` through instead of
  overriding it with `ALREADY_PRESENT`.
- `web` adds the checkbox list to `SearchSubtitlesButton` and an optional argument to both
  actions.

Alternatives rejected: dropping the old tracks in a separate remux before the search (violates
REQ-6 and NFR-1 — the file would be without the language if nothing is found); passing stream
indexes from `api` (the probe report does not carry them and they are only valid for the file the
worker is about to read).

Decision the spec did not cover: if no search ends with an accepted candidate for any language,
there is no embed at all (existing behaviour), so a fully failed replace never touches the file.
If at least one language is accepted, only the accepted ticked languages are dropped.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the migration, the mutation argument, the `REPLACED` value and the new `SubtitleEmbedDetails` field the other two read |
| 2a | `worker` | Reads `SubtitleEmbedDetails.replaceLanguagesIso3`; can start once step 1's schema is generated |
| 2b | `web` | Sends `replaceLanguages` and renders `REPLACED`; can start once step 1's schema is generated |

2a and 2b run in parallel. Both are safe against an older peer: the worker reads a missing field as
empty, and `api` treats an absent argument as today's search.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen. Things an implementer will be tempted to
change and must not:

- **`replaceLanguages` is a list of ISO 3 codes, not track ids.** `web` cannot know track ids and
  the file can change between the dialog and the embed.
- **`SubtitleEmbedDetails.replaceLanguagesIso3: [String!]!`** — the worker-facing name. Always a
  list (empty for a hand embed or a search without replace), never null on the wire.
- **`REPLACED` is a new value, not a reuse of `RESOLVED`.** `web` and `api` add it to the enum in
  the same release; an older `web` would show the raw key, which is why both ship together.
- **Two new error keys** (`replace_language_not_wanted`, `replace_language_not_present`) are
  `BadRequest`s raised before any row is created.

If the contract has to change mid-flight: stop, amend `spec.md`, re-approve, re-brief all three
services.

## Migrations

1. `<ts>_subtitle_search_replace` —
   `ALTER TABLE subtitle_searches ADD replaceLanguages JSON NULL` and
   `ALTER TABLE subtitle_embeds ADD replaceLanguages JSON NULL`.
2. Backfill: none. `NULL` reads as "replace nothing" everywhere, which is what every existing row
   meant.

Reversible by dropping both columns; an embed queued with a drop list would then append only.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| `114`'s file-language override reports a ticked language that failed as `ALREADY_PRESENT` | Silent: the user sees "Ya estaba" and never learns nothing was found | `deriveLanguages` checks the ticked set before the override; unit test for each outcome |
| The worker drops a track of a language that had no accepted candidate | The file loses a subtitle and nothing replaces it | `api` passes only accepted ticked languages; worker unit test that an empty list drops nothing |
| `verifyEmbed` still expects `before + added` streams | Every replace fails verification and is reported as a remux error, file untouched | `verifyEmbed` takes the dropped indexes; unit test for a replace |
| A forced or image track is dropped | Loss of a forced track (signs) the user did not ask about | Selection keeps `disposition.forced` and image codecs; unit test |
| `mkvmerge` track ids differ from `ffprobe` stream indexes | Wrong track dropped, verification may still pass if the language matches | Worker uses the same index convention `buildEmbedArgs` already uses for `--default-track-flag`; the live pass compares tracks before/after |
| The dropped track was the default subtitle | The file has no default subtitle after the replace | Accepted per REQ-5 (the new track gets the flags any searched track gets, `isDefault: false`); noted in the report |
| Stored `fileSubtitleLanguages` is null (never read) | `web` shows no checkbox and `api` refuses a stale request | Correct by construction; documented in the `api` plan |
| A language is present only as a sidecar or an image track | The worker drops nothing, the new track is added beside it, and the outcome still reads `Reemplazado` | Accepted by spec 0.1.1 (REQ-7, REQ-8): `REPLACED` means "searched with replace and embedded", and the dialog hint says forced, image and external subtitles are kept; AC-12 |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test -- subtitle-search subtitle-embed
bin/cli worker npx --no tsc --noEmit
bin/npm worker test -- subtitles
bin/cli web npx --no tsc --noEmit
bin/comments
```

Manual pass (dev stack, `bin/dev -d`):

1. A film whose file holds Spanish and English: open "Buscar subtítulos", see the new title and two
   unticked checkboxes (AC-1). An episode with no Spanish: no Spanish checkbox (AC-2).
2. Tick Spanish and confirm. When the search completes, `ffprobe` the file: the old Spanish text
   track is gone, one new one is there, English unchanged, outcome `Reemplazado` (AC-3, AC-4 with
   a variant-opted user).
3. Tick a language for a title where the provider has nothing (or force rejections): the file's
   size and mtime are unchanged, outcome `No encontrado`/`Rechazado` (AC-5).
4. Confirm with nothing ticked: behaves as before (AC-7).
5. Send the mutation by hand with a language the file lacks: `replace_language_not_present`, no new
   row (AC-8).
6. A file with a forced Spanish track: replace keeps it (AC-9).
7. A delivery's automatic search: `replaceLanguages` stays `NULL` on its row (AC-10).
8. Send the mutation by hand with a language that is not wanted: `replace_language_not_wanted`, no
   new row (AC-11).
9. A title whose Spanish exists only as a `.srt` sidecar: tick it; after acceptance the sidecar is
   still on disk, the new track is embedded, outcome `Reemplazado` (AC-12).
