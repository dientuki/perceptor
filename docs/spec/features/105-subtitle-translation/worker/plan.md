---
title: Subtitle Translation and Adaptation — worker slice
service: worker
last_updated: 2026-10-29
status: Approved
---

# PLAN: Subtitle Translation and Adaptation — `worker` (`worker/plan.md`)

Read first: `../spec.md` (frozen contract), `../plan.md`, `services/worker/CLAUDE.md`,
`.claude/agents/worker.md`.

## Scope

Three small things `api` cannot do:

1. **Report each embedded subtitle track** from the existing `library-probe` job (REQ-17), and
   **widen the sidecar name rule** shared by `library-probe` and `subtitle-probe` so a translated
   file is read back with its real language.
2. **`stage-source`**: re-validate the requested track in the library file and extract it as UTF-8
   SRT into the downloads root.
3. **`write-output`**: write the finished SRT beside the library file under REQ-13's name, never
   overwriting.

It does **not** talk to an LLM, parse or validate translated cues, resolve languages (`api` sends
`targetIso3`), notify a media server, or delete staging files (`api` does, once the row is
terminal). It writes nothing to the library except the one new sidecar and its `.part` scratch.

Writes are confined to `services/worker/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/queue/types.ts` | Modified | Add `SUBTITLE_TRANSLATION_QUEUE = 'subtitle-translation'`, `SUBTITLE_TRANSLATION_STAGE_JOB = 'stage-source'`, `SUBTITLE_TRANSLATION_WRITE_JOB = 'write-output'`, `SubtitleTranslationJob = { subtitleTranslationId: number }` — copied by hand from `api` (no codegen). |
| `src/index.ts` | Modified | One more `Worker` (concurrency 1) constructed **after** `encodeWorkerStarted`, dispatching on `job.name`; unknown names log and return, as the others do. Add it to the "listening on queue" log. |
| `src/jobs/subtitle-translation.job.ts` | New | `handleStageSource(job)`, `handleWriteOutput(job)`. |
| `src/jobs/subtitle-translation.job.spec.ts` | New | Real-temp-dir tests (below). |
| `src/api/subtitle-translation-reports.ts` | New | `subtitleTranslationDetails`, `subtitleTranslationSourceStaged`, `subtitleTranslationWritten`, `subtitleTranslationWorkerFailed` — same shape as `subtitle-probe-reports.ts`. |
| `src/subtitles/translation-output.ts` | New | Pure naming: `sidecarName(base, targetTag, targetIso3, counter?)`; `freeSidecarPath(...)` using `link` (see Steps). |
| `src/subtitles/translation-output.spec.ts` | New | Naming and no-overwrite tests. |
| `src/subtitles/subtitle-sources.ts` | New | `embeddedSubtitleSources(streams)` → `{ ordinal, codec, languageIso3, title, forced }[]`; `resolveTextSource(streams, ordinal, expectedIso3)`. |
| `src/subtitles/subtitle-sources.spec.ts` | New | Ordinal counting and mismatch cases. |
| `src/subtitles/sidecars.ts` (+ `sidecars.spec.ts`) | Modified | Widened name rule (REQ-17). |
| `src/subtitles/library-write.ts` | New | `assertWritable(filePath, uid, gid)` **moved** out of `jobs/subtitle-embed.job.ts` so both jobs share it. |
| `src/jobs/subtitle-embed.job.ts` | Modified | Import `assertWritable` from the new module; behaviour and tests unchanged. |
| `src/jobs/library-probe.job.ts` (+ spec) | Modified | Also send `subtitleSources`. |
| `src/api/library-probe-reports.ts` | Modified | `libraryProbeCompleted` takes and sends the optional `subtitleSources` argument. |
| `src/i18n/error-keys.ts`, `src/i18n/messages.en.ts`, `src/i18n/messages.en.spec.ts` | Modified | The four worker-emitted keys below. |

## Existing code to reuse

- `getMetadata(filePath)` (`ffmpeg/metadata.ts`) for the `ffprobe` read; `runFfmpegCapture(args, signal,
  { binary: 'ffmpeg' })` (`ffmpeg/capture.ts`) for the extraction — the same pair `subtitle-sync.job.ts`
  and `encode/subtitle-prune.ts` use. Extraction is `-map 0:s:<ordinal> -c:s srt -f srt <out>`
  (`subtitle-prune.ts` builds the same `-c:s srt -f srt` arguments).
- `normalizeIso3` (`ffmpeg/iso639.ts`) — compare the stream's language to the request's
  `sourceLanguageIso3` the way `embeddedLanguages` already normalizes it.
- `variantTitle(tag)` (`ffmpeg/variants.ts`) — `Latino` for `es-419`, `Español (España)` for `es-ES`,
  `undefined` for everything else. **Do not add a second table.**
- `deliverReport(label, fn)` (`api/deliver-report.ts`) — retries a lost report until `api` acknowledges it.
- `KeyedError` + `renderMessage` + the `keyed(key, params)` helper idiom in `subtitle-embed.job.ts`.
- `assertWritable` (moved, see above) — checks the library directory is writable and that the file's
  owner can be preserved.
- `embeddedLanguages` (`subtitles/embedded-languages.ts`) and its codec set — `subtitle-sources.ts`
  must apply the same forced/und rules so the two lists never disagree.
- `fixtures/` in `src/subtitles/` for ffprobe stream samples (extend, don't invent a new layout).

## Steps

1. **Verify the naming against a real media server first** (plan risk). With a test `.mkv`, put
   `x.spa.srt`, `x.Latino.spa.srt`, `x.spa.2.srt` beside it and confirm Jellyfin and Plex list each as
   Spanish. If either reads the regional form differently from REQ-13, **stop and report**; the spec
   decides the form, not this slice.
2. `sidecars.ts` name rule. After the `<base>.` prefix and before the extension:
   split on `.`; peel trailing segments from the end while they are a flag (`forced`, `foreign`,
   `sdh`, `cc`, `default`, case-insensitive) or purely numeric; if a peeled flag is `forced` or
   `foreign` the file is dropped (unchanged behaviour); the last remaining segment is the language
   tag, earlier segments are the title. Keep the extension set as is (`.srt .ass .ssa .vtt .sub .sup .idx`).
   Return shape stays `string[]` of tags for `sidecarLanguageTags`; `subtitle-probe.job.ts` is untouched.
3. `subtitle-sources.ts` + `library-probe.job.ts`: count **all** subtitle streams (text and image,
   forced or not) to get the subtitle-relative ordinal `N` that `-map 0:s:N` addresses; report each
   with `codec_name`, `normalizeIso3(tags.language)` (`null` when absent or `und`), `tags.title`,
   `disposition.forced === 1`. `api` filters to translatable text codecs; the worker reports all.
   Send as `subtitleSources`; the rest of the report is unchanged.
4. `stage-source`:
   - `subtitleTranslationDetails(id)`; a `KeyedError` from it (e.g. `not_found`) → log, report
     nothing, return (the `library-probe` posture).
   - `getMetadata(filePath)`; `resolveTextSource(streams, sourceOrdinal, sourceLanguageIso3)` must
     find a **text-codec, non-forced** subtitle stream at that ordinal whose normalized language equals the
     request's. Otherwise report `source_mismatch` and stop. A missing/unreadable file → `source_unreadable`.
   - `mkdir -p dirname(stagedSourcePath)`; run ffmpeg to the staged path (UTF-8 by construction —
     `-c:s srt`); a non-zero exit, or an output that is empty → `source_unreadable` (detail =
     stderr tail, bounded like `STDERR_TAIL_CHARS`).
   - `deliverReport('subtitleTranslationSourceStaged(id)', …)`; if `api` answers `false` the row is no
     longer `EXTRACTING` (a reconcile failed it) → just return.
   - Any unexpected throw → `subtitleTranslationWorkerFailed(id, source_unreadable)`.
5. `write-output`:
   - `subtitleTranslationDetails(id)`; require `stagedOutputPath` to be set and readable.
   - `stat(filePath)`; gone or not a regular file → `file_gone`.
   - `assertWritable(filePath, uid, gid)` (a failure → `write_failed` with the detail).
   - Compute `<base>[.<title>].<targetIso3>.srt` where `<base>` is `basename(filePath)` without its
     extension and `<title>` is `variantTitle(targetTag)` (omitted when `undefined`).
   - Write the bytes to `<final>.part.srt` in the library directory (Article XII's existing
     `<final>.part.<ext>` scratch), `chown` it to the `.mkv`'s `uid`/`gid`, then `link(partPath,
     candidate)` for the base name and, on `EEXIST`, for `…​.2.srt`, `…​.3.srt`, … (bounded, e.g. 99);
     `link` fails rather than overwrites, so no existing file is ever replaced. In a `finally`,
     `rm(partPath, { force: true })` on every outcome. Counter exhausted → `write_failed`.
   - `deliverReport('subtitleTranslationWritten(id, name)')` with the **base name** of the file
     written; `false` from `api` is fine (the file stays; a late write to a failed row is harmless).
   - Any throw → `subtitleTranslationWorkerFailed(id, write_failed | file_gone)`.
6. Register the worker in `index.ts`, mirroring the `library-probe` registration.
7. Error keys emitted by this slice, exactly as in the spec: `error.subtitleTranslation.source_mismatch`,
   `.source_unreadable`, `.file_gone`, `.write_failed`. Add each to `error-keys.ts`, `messages.en.ts`
   (English text, `{detail}` param where it carries one) and the `messages.en.spec.ts` params table.

## Contract obligations

Consumes (read-only): `subtitleTranslationDetails` (`filePath`, `sourceOrdinal`, `sourceLanguageIso3`,
`stagedSourcePath`, `stagedOutputPath`, `targetTag`, `targetIso3`), `subtitleTranslationSourceStaged`,
`subtitleTranslationWritten`, `subtitleTranslationWorkerFailed`, and the extended
`libraryProbeCompleted(…, subtitleSources)` with `LibrarySubtitleSourceInput { ordinal, codec,
languageIso3, title, forced }`.

Every report is `deliverReport`-wrapped. A `false` answer means "not yours any more": abandon
silently. The worker must handle the error condition on `subtitleTranslationDetails`
(`error.subtitleTranslation.not_found`, a `KeyedError`): log and return, report nothing. It must
never send an error key outside the four it owns.

## Tests

- `subtitles/sidecars.spec.ts` — a wrong rule makes a translated file invisible to `108`/`107`, so
  `107` keeps spending OpenSubtitles quota on a language the user already produced; and a too-loose
  one would count a forced track. Cases: `.es.srt`, `.es-419.forced.srt`, `.Latino.spa.srt`,
  `.Español (España).spa.srt`, `.spa.2.srt`, `.spa.forced.2.srt`, `.srt` with no tag, a non-matching
  base name, `.sdh.srt` only.
- `subtitles/subtitle-sources.spec.ts` — a wrong ordinal translates the wrong track silently:
  ordinal counts image tracks and forced tracks; mismatch on language, on codec (image), on
  forced; und/untagged becomes null.
- `subtitles/translation-output.spec.ts` + `jobs/subtitle-translation.job.spec.ts` — run against a
  real `mkdtemp` directory (the `media-roots` standard): free name, `.2` when taken, `.3` when two are
  taken, the pre-existing file is byte-identical afterwards, `.part.srt` never survives (success,
  failure, exhausted counter), owner preserved path called, `file_gone` writes nothing,
  `source_mismatch` extracts nothing and leaves no staged file, `false` from `api` is swallowed.
- `jobs/library-probe.job.spec.ts` (extend) — the report carries `subtitleSources`.
- `i18n/messages.en.spec.ts` — every new key renders.

Not owed: `api/subtitle-translation-reports.ts` (GraphQL plumbing identical to its siblings), the
`index.ts` registration.

## Done when

```bash
bin/cli worker npx --no tsc --noEmit
bin/npm worker run test
bin/comments worker
bin/audit worker
```

`tsc` and tests pass, `bin/comments worker` and `bin/audit worker` exit 0, and
`jobs/subtitle-embed.job.spec.ts` still passes **unchanged** after `assertWritable` moved.
