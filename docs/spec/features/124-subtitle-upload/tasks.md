---
title: Subtitle Upload — Tasks
last_updated: 2026-11-24
status: In Progress
---

# TASKS: Subtitle Upload (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task. |
| `[docs]` | Documentation and the live pass. Owned by the orchestrator. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

There is no `[worker]` task, because the worker contract does not move (`plan.md` § Contract
Freeze). There is no `[infra]` task either. Both body-size limits live inside their own services:
`api`'s `main.ts` and `web`'s `next.config.ts`.

## Tasks

### Group 1 — `api`: staging, embed extension and the contract

- [x] **T001** `[api]` Error keys and the shared constant:
      - `SUBTITLE_EMBED_UPLOAD_TOO_MANY`, `_UPLOAD_NOT_SRT`, `_UPLOAD_TOO_LARGE`, `_REPLACE_FORCED`
        and `_UPLOAD_STAGING_FAILED` in `src/i18n/error-keys.ts`, with English messages in
        `messages.en.ts`;
      - one exported `NON_TERMINAL_SUBTITLE_SEARCH_STATUSES`, which replaces the private copies in
        `subtitle-search.driver.ts` and `subtitle-search-request.service.ts` (`api/plan.md` steps 1
        and 11).

      *Done when:* `bin/cli api npx --no tsc --noEmit` is clean,
      `grep -rn "const NON_TERMINAL = \[" services/api/src` finds nothing, and
      `bin/npm api test -- subtitle-search` passes unchanged.
- [x] **T002** `[api]` Staging:
      - extract `src/media-roots/staging-directory.ts` (`write`, `removeDir`, `sweep(keep)`, each
        removal resolved inside the downloads root) from `subtitle-search/staging.ts`, and re-point
        `SubtitleSearchStaging` at it with no behaviour change;
      - add `src/subtitle-embed/upload-staging.ts` `SubtitleUploadStaging`: `write(embedId, index, bytes)`
        writes to `.perceptor/subtitle-upload/<embedId>/<index>.srt`, `removeEmbed` logs and never
        throws, and a boot sweep keeps only the directories of embeds in `ACTIVE_EMBED_STATUSES`;
      - provide and export it from `SubtitleEmbedModule` (`api/plan.md` steps 2–3).

      → T001

      *Done when:* the existing `staging.spec.ts` passes unchanged, and a new `upload-staging.spec.ts`
      covers three cases: a sweep keeps an active embed's directory, a sweep removes a terminal or
      unknown one, and a path outside the downloads root is never removed. All pass.
- [x] **T003** `[api]` `embedStaged` extension in `subtitle-embed.service.ts` (`api/plan.md` steps 4
      and 6, embed half):
      - `StagedTrackInput` gains optional `fileName`, `isDefault`, `isForced` and `autoOffset`. With
        `autoOffset`, the offset range check is skipped and `offsetMs: 0, autoOffset: true` are
        stored.
      - An optional `stage(embedId) => Promise<string[]>` runs after `createGuarded` and before the
        enqueue. It checks each path is inside the downloads root and writes the paths into `tracks`.
        On a throw, the row is deleted and the upload staging removed.
      - `completed` (after the claim) and `failed` call `uploadStaging.removeEmbed(id)`.
      - `103`'s callers are unchanged.

      → T002

      *Done when:* `subtitle-embed.service.spec.ts` covers four things, and the existing suite still
      passes:
      - `stage` runs after the row exists;
      - a throwing `stage` leaves no row and no directory;
      - `details()` of an upload track gives `isSidecar: false`, `sourcePath === stagedPath`, the
        custom `fileName`, and `isDefault`/`isForced` as sent;
      - `completed`/`failed` call `removeEmbed`.
- [x] **T004** `[api]` `subtitle-embed-sync.service.ts` (`api/plan.md` steps 5 and 6, sync half):
      - `details().candidatePath` and `completed`'s last-cue read use `stagedPath` when present;
      - its three `FAILED` writes (rejection, `failed`, the `enqueueRemux` catch) call
        `uploadStaging.removeEmbed`.

      → T003

      *Done when:* `subtitle-embed-sync.service.spec.ts` asserts three things, and the existing
      `113` cases still pass:
      - `candidatePath === stagedPath` for a staged track;
      - the last cue is read from `stagedPath`;
      - a rejection removes the staging.
- [x] **T005** `[api] [P]` Pure `src/subtitle-upload/decode-upload.ts`: strict base64 →
      `upload_not_srt`, over 2 MiB → `upload_too_large`, `toUtf8` then `U+0000`/`U+FFFD` →
      `charset_undetected`, and `lastCueEndMs === null` → `upload_not_srt` (`api/plan.md` step 7).

      → T001

      *Done when:* `decode-upload.spec.ts` covers cp1252 `¿Señor?` intact, a UTF-8 BOM accepted,
      NUL → `charset_undetected`, no cue, invalid base64, and 2 MiB + 1. All pass.
- [x] **T006** `[api]` The contract:
      - `src/subtitle-upload/` with the module, the `SubtitleUploadInput` DTO (the spec's SDL,
        descriptions included), the resolver (`uploadMovieSubtitles`/`uploadEpisodeSubtitles`, with
        the global auth guard and no `AdminGuard`) and `SubtitleUploadService`;
      - the service applies the refusals in the spec's table order, locates a file through
        `LibraryLocationService` with the `subtitleEmbed.*` key mapping, and calls `embedStaged` with
        the `stage` callback, `variantTag` = the chosen tag, `provenance` = the file name and
        `provider: 'user'`;
      - wire the module into `app.module.ts` (`api/plan.md` steps 8–9).

      → T004, T005

      *Done when:* `schema.gql` shows `SubtitleUploadInput` and both mutations exactly as in
      `spec.md`, and `subtitle-upload.service.spec.ts` covers every case listed in `api/plan.md`
      § Tests. All pass. `grep -rn "embedStaged" services/api/src --include=*.ts | grep -v spec.ts`
      shows callers only in `subtitle-search/` and `subtitle-upload/`.
- [x] **T007** `[api] [P]` Give `/graphql` its own `json({ limit: '32mb' })` in `src/main.ts`, ahead
      of the global 2 MB parser, which must skip a body that is already parsed (`api/plan.md` step 10).

      *Done when:* with the dev stack up, a 25 MB GraphQL body sent with `curl` from inside the `web`
      container to `http://api:${API_PORT}/graphql` reaches the resolver layer (a GraphQL error, not
      `413`), a 33 MB body gets `413`, and a 3 MB `POST` to any non-GraphQL route still gets `413`.

### Group 2 — `web`

T008–T010 do not call `api` and can start alongside Group 1. T011 onward consume the contract and
wait for T006.

- [x] **T008** `[web] [P]` Shared pieces, with no behaviour change to the embed dialog:
      - move `OFFSET_LIMIT`/`parseOffset` into `src/components/media/subtitle-offset.ts`;
      - extract the in-flight / failure / warning lines of `EmbedSubtitlesButton` into
        `SubtitleEmbedOutcome.tsx`;
      - `EmbedSubtitlesButton` stops rendering failure/warning but keeps its disabled in-flight
        state and stale message (`web/plan.md` steps 4 and 7).

      *Done when:* `bin/cli web npx --no tsc --noEmit` and `bin/npm web run lint` are clean, and the
      admin embed dialog on a film with a sidecar still opens, validates the offset and embeds
      (checked in T015).
- [x] **T009** `[web] [P]` `src/lib/subtitle-file-name.ts` `presetFromFileName(fileName, languages)`,
      following REQ-5 as specified in `web/plan.md` step 3.

      *Done when:* typecheck and lint are clean. Because `web` has no test runner, the four example
      names (`Green Book (2018).es-419.srt` → `es-419`; `Green Book.eng.forced.srt` → `en` and
      forced; `Movie.2019.1080p.spa.forced.srt` → `es` and forced; `subs.srt` → none) are checked
      in T015 (AC-3).
- [x] **T010** `[web] [P]` Set the server-action body limit to `24mb` in `next.config.ts`, under the key
      Next 16 actually reads, confirmed in `node_modules/next/dist/docs/` (`web/plan.md` step 2).

      *Done when:* the dev `web` container restarts clean, and the confirmed key and the doc path
      that confirms it are named in the task report.
- [x] **T011** `[web]` `SubtitleUploadInput` in `src/types/media.ts`, plus `uploadMovieSubtitlesAction`
      (`src/actions/movies.ts`) and `uploadEpisodeSubtitlesAction` (`src/actions/shows.ts`)
      mirroring `embedMovieSubtitlesAction`'s error handling (`web/plan.md` step 1).

      → T006

      *Done when:* typecheck and lint are clean, and the mutation strings match `schema.gql`'s field
      and argument names exactly.
- [x] **T012** `[web]` The dialog and the button (`web/plan.md` steps 5, 6 and 9):
      - `UploadSubtitlesModal.tsx` with every per-row control (language over all `languages`,
        forced, default, replace gated on `fileSubtitleLanguages` and not forced, offset +
        "Automático", remove), the pre-checks (`.srt`, 2 MiB, 8 files), and bytes read with
        `arrayBuffer()` and base64-encoded, never `file.text()`;
      - `UploadSubtitlesButton.tsx` (icon-only `Upload`, tooltip and `aria-label`, disabled while
        the embed or the search is in flight, `busy`/`in_progress` close the dialog and refresh);
      - the `media.uploadSubtitles.*` catalog and five `errors.subtitleEmbed.*` keys in
        `messages/{es,en}.json`.

      → T008, T009, T011

      *Done when:* typecheck, lint and `bin/comments web` are clean, and
      `grep -n "\.text()" src/components/media/UploadSubtitlesModal.tsx` finds nothing.
- [x] **T013** `[web]` Placement (`web/plan.md` step 8):
      - `Movie.tsx`: the search button (when available) and the upload button in one row, then
        `SubtitleEmbedOutcome`, both gated on `status === "COMPLETED"`;
      - `SeasonAccordion.tsx`: the same pair, `compact`, in each episode's "Pistas" cell;
      - no season-level button.

      → T012

      *Done when:* typecheck and lint are clean, and the film page and an expanded season render
      the icon in the dev stack (checked in T015, AC-1/AC-2).

### Group 3 — verification and docs

- [x] **T014** `[docs]` Add a `124-subtitle-upload` section to `docs/spec/graphql-contract.md`: the
      input, both mutations, the refusal order and the new keys, the `contentBase64` raw-bytes rule,
      and the unchanged worker surface. Update `services/api/CLAUDE.md` (`subtitle-upload/` entry,
      the `embedStaged` caller rule from constitution v1.9.0, the `/graphql` body limit) and
      `services/web/CLAUDE.md` (the upload dialog, `SubtitleEmbedOutcome`). Add `124` to the root
      `CLAUDE.md` pipeline table's "Notify media server" and "Browse library" rows. No stage
      changes status.

      → T006, T013

      *Done when:* each file names `124` and `bin/comments api` / `bin/comments web` still pass.
- [ ] **T015** `[docs]` Live pass. Run `plan.md` § Verification's commands, then the manual pass for
      AC-1 through AC-14 in the dev stack, recording each result (command output, `ffprobe` /
      `mkvinfo` / `mkvextract` excerpts, `sha256sum` before and after, the staging directory
      listings).

      → T007, T010, T013, T014

      *Done when:* every AC has a recorded outcome, and any failure is filed in **Blocked** or as a
      follow-up task, never ticked.
- [ ] **T016** `[docs]` Tick each acceptance criterion in `spec.md` that T015 proved. Set
      `status: Implemented` on `spec.md`, `plan.md`, `api/plan.md` and `web/plan.md`, and
      `status: Done` here. Append the measurement entry to `docs/spec/history.md`. Run
      `bin/pending-acs`.

      → T015

      *Done when:* `bin/pending-acs --check` exits 0, and `grep -n "^status" docs/spec/features/124-subtitle-upload/*.md docs/spec/features/124-subtitle-upload/*/plan.md`
      shows `Implemented`/`Done` everywhere.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |
| T015 | docs | The dev stack cannot start: host port 4000 is held by another Perceptor install, so `api` and `web` are not running. The live pass (AC-1 to AC-14) needs a real film, a series, a non-admin owner and a non-owner. | The user to free the port (`bin/stop`), start `bin/dev -d` and confirm the library fixtures. |
